"""
Standalone Flask app to serve eDrawings WebHTML files for 3D viewing.
Opens in Internet Explorer (required for eDrawings ActiveX control).

Usage:
    python test_3d_viewer.py
    Browser will open automatically in IE
"""
import os
import subprocess
from flask import Flask, send_from_directory, render_template_string, jsonify, request

app = Flask(__name__)
VIEWER_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "3d_viewer_output")
IE_PATH = r"C:\Program Files\Internet Explorer\iexplore.exe"

INDEX_HTML = """
<!DOCTYPE html>
<html>
<head>
    <title>3D Viewer - eDrawings</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: #1a1a2e;
            color: #eee;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
        }
        .container { text-align: center; max-width: 600px; }
        h1 { color: #e94560; margin-bottom: 20px; }
        .file-list {
            background: #16213e;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
        }
        .file-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 16px;
            margin: 8px 0;
            background: #0f3460;
            border-radius: 6px;
            cursor: pointer;
            transition: background 0.2s;
        }
        .file-item:hover { background: #533483; }
        .file-name { font-size: 16px; }
        .file-size { font-size: 12px; color: #888; }
        .btn-open {
            background: #e94560;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        }
        .btn-open:hover { background: #c73650; }
        .info {
            color: #888;
            font-size: 13px;
            margin-top: 16px;
            line-height: 1.6;
        }
        .status { margin-top: 10px; color: #4ade80; font-size: 14px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>eDrawings 3D Viewer</h1>
        {% if files %}
        <div class="file-list">
            {% for f in files %}
            <div class="file-item" onclick="openInIE('{{ f.name }}')">
                <div>
                    <div class="file-name">{{ f.name.replace('.htm', '') }}</div>
                    <div class="file-size">{{ f.size_mb }} MB</div>
                </div>
                <button class="btn-open">Open in 3D Viewer</button>
            </div>
            {% endfor %}
        </div>
        <div class="info">
            Clicking "Open" will launch the eDrawings viewer in Internet Explorer.<br>
            Features: 3D rotation, parts tree, hide/show, measure tool.
        </div>
        {% else %}
        <div class="info">
            No .htm files found in 3d_viewer_output/.<br>
            Run <code>python edrawings_export.py</code> first.
        </div>
        {% endif %}
        <div id="status" class="status"></div>
    </div>
    <script>
        function openInIE(filename) {
            document.getElementById('status').textContent = 'Opening ' + filename.replace('.htm','') + ' in eDrawings viewer...';
            fetch('/open-ie/' + filename, {method: 'POST'})
                .then(r => r.json())
                .then(data => {
                    if (data.success) {
                        document.getElementById('status').textContent = 'Viewer opened!';
                    } else {
                        document.getElementById('status').textContent = 'Error: ' + data.error;
                        document.getElementById('status').style.color = '#ef4444';
                    }
                });
        }
    </script>
</body>
</html>
"""


@app.route("/")
@app.route("/viewer")
def viewer():
    files = []
    if os.path.exists(VIEWER_DIR):
        for f in sorted(os.listdir(VIEWER_DIR)):
            if f.endswith(".htm"):
                size_mb = os.path.getsize(os.path.join(VIEWER_DIR, f)) / (1024 * 1024)
                files.append({"name": f, "size_mb": f"{size_mb:.1f}"})
    return render_template_string(INDEX_HTML, files=files)


@app.route("/file/<path:filename>")
def serve_file(filename):
    return send_from_directory(VIEWER_DIR, filename)


@app.route("/open-ie/<path:filename>", methods=["POST"])
def open_in_ie(filename):
    """Launch Internet Explorer with the eDrawings WebHTML file."""
    if not os.path.exists(IE_PATH):
        return jsonify({"success": False, "error": "Internet Explorer not found"})

    # Serve via localhost so IE can load it properly
    host = request.host.split(":")[0]
    url = f"http://{host}:5555/file/{filename}"

    try:
        subprocess.Popen([IE_PATH, url])
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


if __name__ == "__main__":
    print(f"Serving files from: {VIEWER_DIR}")
    if os.path.exists(VIEWER_DIR):
        files = [f for f in os.listdir(VIEWER_DIR) if f.endswith(".htm")]
        print(f"Found {len(files)} HTM files: {files}")
    else:
        print("Warning: Output directory does not exist yet.")
    print(f"\nOpen http://localhost:5555/viewer in your browser")
    print(f"Click a file to launch it in Internet Explorer with full eDrawings 3D viewer")
    app.run(host="0.0.0.0", port=5555, debug=False)
