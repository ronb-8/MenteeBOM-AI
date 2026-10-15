"""
In-app Bug Report API Blueprint
===============================
Backs the floating "Report Bug" button: takes a title/description from a
logged-in user and creates an issue in Jira via the REST API (v3).

Jira credentials live only on the server (environment / .env) — the browser
never sees the API token. Configuration:

    JIRA_BASE_URL     e.g. https://menteebot.atlassian.net
    JIRA_EMAIL        Atlassian account email that owns the API token
    JIRA_API_TOKEN    https://id.atlassian.com/manage-profile/security/api-tokens
    JIRA_PROJECT_KEY  default: FEAT
    JIRA_ISSUE_TYPE   default: Task (must exist in the project; FEAT has no 'Bug' type)
"""
import os

import requests
from flask import Blueprint, request, jsonify, current_app
from flask_login import login_required, current_user

bug_report_bp = Blueprint('bug_report', __name__)

MAX_TITLE_LENGTH = 255  # Jira's limit for `summary`
MAX_DESCRIPTION_LENGTH = 20000
SEVERITIES = ('Low', 'Medium', 'High', 'Critical')
JIRA_TIMEOUT_SECONDS = 15


def _jira_config():
    """Read Jira settings from the environment. Returns (config, missing_keys)."""
    config = {
        'base_url': os.environ.get('JIRA_BASE_URL', 'https://menteebot.atlassian.net').rstrip('/'),
        'email': os.environ.get('JIRA_EMAIL', ''),
        'api_token': os.environ.get('JIRA_API_TOKEN', ''),
        'project_key': os.environ.get('JIRA_PROJECT_KEY', 'FEAT'),
        'issue_type': os.environ.get('JIRA_ISSUE_TYPE', 'Task'),
    }
    missing = [name for name, key in (('JIRA_EMAIL', 'email'), ('JIRA_API_TOKEN', 'api_token'))
               if not config[key]]
    return config, missing


def _adf_paragraph(text, bold_label=None):
    """One Atlassian Document Format paragraph, optionally prefixed with a bold label."""
    content = []
    if bold_label:
        content.append({'type': 'text', 'text': f'{bold_label}: ', 'marks': [{'type': 'strong'}]})
    if text:
        content.append({'type': 'text', 'text': text})
    return {'type': 'paragraph', 'content': content}


def _build_description(description, severity, page_url, user_agent):
    """Jira Cloud v3 requires `description` as an ADF document, not plain text."""
    blocks = [_adf_paragraph(line) for line in description.split('\n') if line.strip()]
    blocks.append({'type': 'rule'})
    blocks.append(_adf_paragraph(severity or 'Not specified', 'Severity'))
    blocks.append(_adf_paragraph(f'{current_user.username} ({current_user.email})', 'Reported by'))
    if page_url:
        blocks.append(_adf_paragraph(page_url, 'Page'))
    if user_agent:
        blocks.append(_adf_paragraph(user_agent, 'Browser'))
    blocks.append(_adf_paragraph('MenteeBOM in-app bug reporter', 'Source'))
    return {'type': 'doc', 'version': 1, 'content': blocks}


def _jira_error_message(response):
    """Pull a readable message out of a Jira error response."""
    try:
        body = response.json()
    except ValueError:
        return response.text[:500] or f'HTTP {response.status_code}'
    messages = list(body.get('errorMessages') or [])
    messages += [f'{field}: {msg}' for field, msg in (body.get('errors') or {}).items()]
    return '; '.join(messages) or f'HTTP {response.status_code}'


@bug_report_bp.route('/api/bug-report', methods=['POST'])
@login_required
def create_bug_report():
    data = request.get_json(silent=True) or {}
    title = (data.get('title') or '').strip()
    description = (data.get('description') or '').strip()
    severity = (data.get('severity') or '').strip() or None
    page_url = (data.get('page_url') or '').strip()[:2000]

    if not title:
        return jsonify({'success': False, 'error': 'Title is required.'}), 400
    if len(title) > MAX_TITLE_LENGTH:
        return jsonify({'success': False, 'error': f'Title must be at most {MAX_TITLE_LENGTH} characters.'}), 400
    if not description:
        return jsonify({'success': False, 'error': 'Description is required.'}), 400
    if len(description) > MAX_DESCRIPTION_LENGTH:
        return jsonify({'success': False, 'error': f'Description must be at most {MAX_DESCRIPTION_LENGTH} characters.'}), 400
    if severity and severity not in SEVERITIES:
        return jsonify({'success': False, 'error': f'Severity must be one of: {", ".join(SEVERITIES)}.'}), 400

    config, missing = _jira_config()
    if missing:
        current_app.logger.error('Bug report: Jira is not configured (missing %s)', ', '.join(missing))
        return jsonify({'success': False,
                        'error': 'Bug reporting is not configured on the server. Please contact an administrator.'}), 503

    labels = ['menteebom', 'in-app-report']
    if severity:
        labels.append(f'severity-{severity.lower()}')

    payload = {
        'fields': {
            'project': {'key': config['project_key']},
            'issuetype': {'name': config['issue_type']},
            'summary': title,
            'description': _build_description(description, severity, page_url,
                                              request.headers.get('User-Agent', '')[:500]),
            'labels': labels,
        }
    }

    try:
        response = requests.post(
            f"{config['base_url']}/rest/api/3/issue",
            json=payload,
            auth=(config['email'], config['api_token']),
            headers={'Accept': 'application/json'},
            timeout=JIRA_TIMEOUT_SECONDS,
        )
    except requests.Timeout:
        current_app.logger.error('Bug report: Jira request timed out')
        return jsonify({'success': False, 'error': 'Jira did not respond in time. Please try again.'}), 504
    except requests.RequestException as exc:
        current_app.logger.error('Bug report: could not reach Jira: %s', exc)
        return jsonify({'success': False, 'error': 'Could not reach Jira. Please try again later.'}), 502

    if response.status_code == 201:
        issue_key = response.json().get('key')
        current_app.logger.info('Bug report %s created by %s', issue_key, current_user.username)
        return jsonify({
            'success': True,
            'issue_key': issue_key,
            'issue_url': f"{config['base_url']}/browse/{issue_key}",
        }), 201

    detail = _jira_error_message(response)
    current_app.logger.error('Bug report: Jira returned %s: %s', response.status_code, detail)

    # Never pass Jira's 401/403 through as-is: the frontend treats 401 as "your session expired".
    if response.status_code in (401, 403):
        return jsonify({'success': False,
                        'error': 'The server could not authenticate with Jira. Please contact an administrator.'}), 502
    if response.status_code == 400:
        return jsonify({'success': False, 'error': f'Jira rejected the ticket: {detail}'}), 502
    return jsonify({'success': False, 'error': f'Jira error ({response.status_code}). Please try again later.'}), 502
