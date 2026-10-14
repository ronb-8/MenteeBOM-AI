"""
Logging utility for MenteeBOM application.
Creates daily log files in Documents/MenteeBOM Data/logs/
"""
import os
import logging
from datetime import datetime
from pathlib import Path

# Get user's Documents folder path
DOCUMENTS_PATH = Path.home() / "Documents"
MENTEEBOM_DATA_PATH = DOCUMENTS_PATH / "MenteeBOM Data"
LOGS_PATH = MENTEEBOM_DATA_PATH / "logs"

# Ensure logs directory exists
LOGS_PATH.mkdir(parents=True, exist_ok=True)


def get_log_file_path():
    """Get the log file path for today's date"""
    today = datetime.now().strftime("%Y-%m-%d")
    log_filename = f"menteebom_{today}.log"
    return LOGS_PATH / log_filename


def get_logger():
    """
    Get a logger instance configured for MenteeBOM.
    Logs are written to daily log files in Documents/MenteeBOM Data/logs/
    The file handler is reused until the date rolls over — recreating it per
    call leaked one open file handle per log line.
    """
    logger = logging.getLogger('menteebom')
    logger.setLevel(logging.INFO)

    log_file = str(get_log_file_path())

    # Reuse the existing handler if it already points at today's file
    for handler in logger.handlers:
        if isinstance(handler, logging.FileHandler):
            if getattr(handler, 'baseFilename', None) == os.path.abspath(log_file):
                return logger
            # Date rolled over — close and replace the stale handler
            logger.removeHandler(handler)
            handler.close()

    file_handler = logging.FileHandler(log_file, encoding='utf-8')
    file_handler.setLevel(logging.INFO)
    formatter = logging.Formatter('[%(asctime)s] [%(levelname)s] %(message)s', datefmt='%Y-%m-%d %H:%M:%S')
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    return logger


def log_action(action_type, user, details, level='INFO'):
    """
    Log a database action or admin action.
    
    Args:
        action_type (str): Type of action (e.g., 'BOM_IMPORT', 'BOM_UPDATE', 'USER_CREATE')
        user: User object or dict with username and role
        details (str): Additional details about the action
        level (str): Log level ('INFO', 'WARNING', 'ERROR')
    """
    logger = get_logger()
    
    # Get user info
    if hasattr(user, 'username'):
        username = user.username
        role = getattr(user, 'role', 'unknown')
    elif isinstance(user, dict):
        username = user.get('username', 'unknown')
        role = user.get('role', 'unknown')
    else:
        username = str(user)
        role = 'unknown'
    
    # Format log message
    log_message = f"[USER:{username}] [ROLE:{role}] [ACTION:{action_type}] {details}"
    
    # Log with appropriate level
    if level == 'ERROR':
        logger.error(log_message)
    elif level == 'WARNING':
        logger.warning(log_message)
    else:
        logger.info(log_message)


def read_logs(date=None, max_lines=1000):
    """
    Read log entries from log files.
    
    Args:
        date (str): Date in YYYY-MM-DD format. If None, reads today's log
        max_lines (int): Maximum number of lines to return
    
    Returns:
        list: List of log entries as dictionaries
    """
    if date is None:
        log_file = get_log_file_path()
    else:
        log_filename = f"menteebom_{date}.log"
        log_file = LOGS_PATH / log_filename
    
    if not log_file.exists():
        return []
    
    entries = []
    try:
        with open(log_file, 'r', encoding='utf-8') as f:
            lines = f.readlines()
            # Read last max_lines (most recent first)
            for line in reversed(lines[-max_lines:]):
                line = line.strip()
                if line:
                    # Extract timestamp from format: [2024-01-01 12:00:00] [LEVEL] ...
                    timestamp = line[1:20] if len(line) > 20 and line.startswith('[') else ''
                    entries.append({
                        'timestamp': timestamp,
                        'raw': line,
                        'full': line
                    })
    except Exception as e:
        logger = get_logger()
        logger.error(f"Error reading log file: {e}")
    
    return entries


def get_available_log_dates():
    """Get list of available log file dates"""
    if not LOGS_PATH.exists():
        return []
    
    dates = []
    for log_file in LOGS_PATH.glob("menteebom_*.log"):
        # Extract date from filename: menteebom_YYYY-MM-DD.log
        date_str = log_file.stem.replace("menteebom_", "")
        dates.append(date_str)
    
    return sorted(dates, reverse=True)

