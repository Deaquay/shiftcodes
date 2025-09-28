import requests
import datetime
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
import logging

logging.basicConfig(level=logging.INFO)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

RAW_JSON_URL = "https://raw.githubusercontent.com/xGrim81/bl4-shift-codes/refs/heads/main/docs/codes.json"

def fetch_codes():
    try:
        logging.info(f"Requesting: {RAW_JSON_URL}")
        resp = requests.get(RAW_JSON_URL, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        codes = data.get("codes", [])
        now = datetime.datetime.now(datetime.timezone.utc)
        active, expired = [], []
        for code in codes:
            exp_str = code.get("expires")
            # Null means permanent or unknown-expiry
            if exp_str:
                # Parse TZ-aware string to datetime
                expires = datetime.datetime.fromisoformat(exp_str)
                if expires > now:
                    active.append(code)
                else:
                    expired.append(code)
            else:
                active.append(code)
        # Keep JSON order (newest at top for both sections)
        return {"active": active, "expired": expired}
    except Exception as e:
        logging.error(f"Failed to fetch/parse codes: {e}")
        return {"active": [], "expired": []}

@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    codes = fetch_codes()
    html = """
    <!DOCTYPE html>
    <html>
    <head>
      <title>Borderlands 4 SHiFT Codes Tracker</title>
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <style>
        body { font-family: sans-serif; background: #191622; color: #faf9f7; padding: 2em; }
        h2, h3 { margin-top:2em; }
        table { width: 100%; border-collapse: collapse; background: #292535; box-shadow: 0 2px 8px #0002; }
        th, td { border: 1px solid #444; padding: 10px; text-align: left; }
        th { background: #28202d; }
        .expired { background: #32151d; color: #fad7d7 }
        input[type='checkbox'] { transform: scale(1.5); }
        .codeblock { font-family: monospace; font-size: 1.15em; }
        small { color: #bbb }
        .copy-btn {
          min-width: 70px; /* ensures both "Copy" and "Copied!" fit cleanly */
          text-align: center;
          display: inline-block;
          /* Optional: tweak padding, font-size for your design */
        }
      </style>
    </head>
    <body>
      <h2>Borderlands 4 SHiFT Codes</h2>
      <h3>Active & Permanent Codes</h3>
      <p>Check off codes you've redeemed (saved locally on this device).</p>
      <table id="activeTable">
        <thead>
          <tr>
            <th>Used</th>
            <th>Code</th>
            <th>Reward</th>
            <th>Expires</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
    """
    for row in codes['active']:
        html += f"""<tr>
            <td><input type="checkbox" data-code="{row['code']}"></td>
            <td class="codeblock">
                {row['code']}
                <button class="copy-btn" data-code="{row['code']}" title="Copy to clipboard" style="margin-left:0.66em;">Copy</button>
            </td>
            <td>{row['reward']}</td>
            <td>{row.get('expires', '') or '<b>Permanent</b>'}</td>
            <td>
              <a href="{row['source']}" target="_blank"><small>link</small></a>
            </td>
        </tr>"""
    html += """
        </tbody>
      </table>
      <h3>Expired Codes</h3>
      <table id="expiredTable">
        <thead>
          <tr>
            <th>Code</th>
            <th>Reward</th>
            <th>Expired</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
    """
    for row in codes['expired']:
        html += f"""<tr class="expired">
            <td class="codeblock">{row['code']}</td>
            <td>{row['reward']}</td>
            <td>{row.get('expires', '')}</td>
            <td>
              <a href="{row['source']}" target="_blank"><small>link</small></a>
            </td>
        </tr>"""
    html += """
        </tbody>
      </table>
      <script>
        // Debugging output
        const active = Array.from(document.querySelectorAll("#activeTable tbody tr .codeblock")).map(td=>td.textContent);
        const expired = Array.from(document.querySelectorAll("#expiredTable tbody tr .codeblock")).map(td=>td.textContent);
        console.log('Active codes:', active.length, active);
        console.log('Expired codes:', expired.length, expired);
        // Restore checked state from localStorage
        document.querySelectorAll("#activeTable input[type='checkbox']").forEach(cb => {
          const code = cb.getAttribute('data-code');
          cb.checked = localStorage.getItem('shiftcode_' + code) === '1';
          cb.addEventListener('change', () => {
            localStorage.setItem('shiftcode_' + code, cb.checked ? '1' : '');
          });
        });
        document.querySelectorAll(".copy-btn").forEach(btn => {
          btn.addEventListener("click", function(evt) {
            const code = btn.getAttribute("data-code");
            navigator.clipboard.writeText(code).then(() => {
              btn.textContent = "Copied!";
              setTimeout(() => { btn.textContent = "Copy"; }, 1500);
            });
          });
        });
      </script>
    </body>
    </html>
    """
    return HTMLResponse(content=html)
