import asyncio
import os
import subprocess
import logging
import datetime
from fastapi import FastAPI, Request, BackgroundTasks
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(level=logging.INFO)
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration
LOCAL_CODES_PATH = "docs/codes.json"
UPDATE_INTERVAL = 3600  # 1 hour in seconds

def run_scraper() -> bool:
    """Run the Node.js scraper to update codes"""
    try:
        logging.info("Running code scraper...")
        result = subprocess.run(
            ["npm", "run", "build"], 
            cwd=".",
            capture_output=True, 
            text=True,
            timeout=180
        )
        if result.returncode == 0:
            logging.info("Scraper completed successfully")
            logging.info(f"Scraper output: {result.stdout}")
            return True
        else:
            logging.error(f"Scraper failed: {result.stderr}")
            return False
    except subprocess.TimeoutExpired:
        logging.error("Scraper timed out after 3 minutes")
        return False
    except Exception as e:
        logging.error(f"Failed to run scraper: {e}")
        return False

def load_local_codes():
    """Load codes from local file"""
    try:
        if os.path.exists(LOCAL_CODES_PATH):
            with open(LOCAL_CODES_PATH, 'r', encoding='utf-8') as f:
                data = f.read()
                if not data.strip():
                    logging.warning("Local codes file is empty")
                    return None
                import json
                parsed = json.loads(data)
                logging.info(f"Loaded {len(parsed.get('codes', []))} codes from local file")
                return parsed
        else:
            logging.warning(f"Local codes file not found: {LOCAL_CODES_PATH}")
    except Exception as e:
        logging.error(f"Failed to load local codes: {e}")
    return None

def fetch_codes():
    """Fetch codes from local file"""
    data = load_local_codes()
    
    if not data:
        return {"active": [], "expired": [], "error": "No codes available"}
    
    # Process codes with more aggressive expiration logic
    codes = data.get("codes", [])
    now = datetime.datetime.now(datetime.timezone.utc)
    active, expired = [], []
    
    for code in codes:
        exp_str = code.get("expires")
        is_expired = False
        
        if exp_str:
            try:
                expires = datetime.datetime.fromisoformat(exp_str)
                # More aggressive: if expires today, consider it expired
                if expires <= now:
                    is_expired = True
            except ValueError:
                # If date parsing fails, check if it looks like a past date
                if any(month in exp_str.lower() for month in ['sep', 'september']) and '26' in exp_str:
                    is_expired = True
        
        if is_expired:
            expired.append(code)
        else:
            active.append(code)
    
    return {"active": active, "expired": expired}

async def periodic_update():
    """Background task to update codes every hour"""
    await asyncio.sleep(300)  # Wait 5 minutes after startup before first update
    
    while True:
        try:
            logging.info("Running periodic code update...")
            success = run_scraper()
            if success:
                logging.info("Periodic update completed successfully")
            else:
                logging.warning("Periodic update failed")
        except Exception as e:
            logging.error(f"Periodic update error: {e}")
        
        # Wait for next update
        await asyncio.sleep(UPDATE_INTERVAL)

@app.on_event("startup")
async def startup_event():
    """Start background tasks on startup"""
    logging.info("Starting background update task...")
    asyncio.create_task(periodic_update())

@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    codes = fetch_codes()
    
    last_updated = "Unknown"
    local_data = load_local_codes()
    if local_data and "updated" in local_data:
        try:
            updated_time = datetime.datetime.fromisoformat(local_data["updated"].replace('Z', '+00:00'))
            last_updated = updated_time.strftime("%Y-%m-%d %H:%M:%S UTC")
        except:
            pass
    
    html = f"""
<!DOCTYPE html>
<html>
<head>
    <title>Borderlands 4 SHiFT Codes</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body {{ font-family: Arial, sans-serif; margin: 20px; background: #1a1a1a; color: #fff; }}
        .header {{ background: #2d2d2d; padding: 20px; border-radius: 8px; margin-bottom: 20px; }}
        .status {{ display: flex; gap: 20px; margin: 10px 0; flex-wrap: wrap; }}
        .section {{ background: #2d2d2d; padding: 15px; border-radius: 8px; margin-bottom: 20px; }}
        table {{ width: 100%; border-collapse: collapse; }}
        th, td {{ padding: 10px; text-align: left; border-bottom: 1px solid #444; }}
        th {{ background: #3d3d3d; }}
        .code {{ font-family: monospace; background: #444; padding: 4px 8px; border-radius: 4px; }}
        .active {{ border-left: 4px solid #4CAF50; }}
        .expired {{ border-left: 4px solid #f44336; opacity: 0.7; }}
        .refresh-btn {{ background: #4CAF50; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; }}
        .refresh-btn:hover {{ background: #45a049; }}
        .refresh-btn:disabled {{ background: #666; cursor: not-allowed; }}
        .copy-btn {{ background: #2196F3; color: white; border: none; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-size: 12px; }}
        .copy-btn:hover {{ background: #1976D2; }}
        .copy-btn:disabled {{ background: #666; }}
        .checkbox {{ margin-right: 8px; }}
        .redeemed {{ opacity: 0.5; text-decoration: line-through; }}
        a {{ color: #64B5F6; }}
        .update-info {{ font-size: 14px; color: #aaa; margin-top: 10px; }}
        .code-actions {{ display: flex; gap: 8px; align-items: center; }}
        @media (max-width: 768px) {{ .status {{ flex-direction: column; gap: 10px; }} }}
    </style>
</head>
<body>
    <div class="header">
        <h1>🎮 Borderlands 4 SHiFT Codes</h1>
        <div class="status">
            <div><strong>Last Updated:</strong> {last_updated}</div>
            <div><strong>Active Codes:</strong> {len(codes['active'])}</div>
            <div><strong>Expired Codes:</strong> {len(codes['expired'])}</div>
        </div>
        <button class="refresh-btn" onclick="updateCodes()">🔄 Force Update</button>
        <div class="update-info">Updates automatically every hour</div>
    </div>

    <div class="section active">
        <h2>🟢 Active Codes ({len(codes['active'])})</h2>
        <table>
            <tr><th>✓</th><th>Code</th><th>Reward</th><th>Expires</th><th>Actions</th><th>Source</th></tr>
"""
    
    for row in codes['active']:
        code = row['code']
        expires = row.get('expires', 'Permanent')
        if expires and expires != 'Permanent':
            try:
                exp_time = datetime.datetime.fromisoformat(expires.replace('Z', '+00:00'))
                expires_display = exp_time.strftime("%m/%d/%Y")
            except:
                expires_display = expires
        else:
            expires_display = "Permanent"
        
        source_link = f"<a href='{row['source']}' target='_blank'>Source</a>" if row.get('source') else "—"
        html += f"""
            <tr id="code-{code}" class="code-row">
                <td>
                    <input type="checkbox" class="checkbox" id="check-{code}" onchange="toggleRedeemed('{code}')">
                </td>
                <td><span class="code">{code}</span></td>
                <td>{row.get('reward', '—')}</td>
                <td>{expires_display}</td>
                <td>
                    <div class="code-actions">
                        <button class="copy-btn" onclick="copyCode('{code}')">📋 Copy</button>
                    </div>
                </td>
                <td>{source_link}</td>
            </tr>
        """
    
    if codes['expired']:
        html += f"""
        </table>
    </div>

    <div class="section expired">
        <h2>🔴 Expired Codes ({len(codes['expired'])})</h2>
        <table>
            <tr><th>Code</th><th>Reward</th><th>Expired</th><th>Source</th></tr>
"""
        
        for row in codes['expired']:
            code = row['code']
            expired = row.get('expires', '')
            if expired:
                try:
                    exp_time = datetime.datetime.fromisoformat(expired.replace('Z', '+00:00'))
                    expired_display = exp_time.strftime("%m/%d/%Y")
                except:
                    expired_display = expired
            else:
                expired_display = "Unknown"
            
            source_link = f"<a href='{row['source']}' target='_blank'>Source</a>" if row.get('source') else "—"
            html += f"""
                <tr>
                    <td><span class="code">{code}</span></td>
                    <td>{row.get('reward', '—')}</td>
                    <td>{expired_display}</td>
                    <td>{source_link}</td>
                </tr>
            """
    else:
        html += """</table>
    </div>"""
    
    html += """
    <script>
        // Load redeemed codes from localStorage
        function loadRedeemedCodes() {
            const redeemed = JSON.parse(localStorage.getItem('redeemedCodes') || '[]');
            redeemed.forEach(code => {
                const checkbox = document.getElementById(`check-${code}`);
                const row = document.getElementById(`code-${code}`);
                if (checkbox && row) {
                    checkbox.checked = true;
                    row.classList.add('redeemed');
                }
            });
        }

        // Toggle redeemed status
        function toggleRedeemed(code) {
            const checkbox = document.getElementById(`check-${code}`);
            const row = document.getElementById(`code-${code}`);
            const redeemed = JSON.parse(localStorage.getItem('redeemedCodes') || '[]');
            
            if (checkbox.checked) {
                row.classList.add('redeemed');
                if (!redeemed.includes(code)) {
                    redeemed.push(code);
                }
            } else {
                row.classList.remove('redeemed');
                const index = redeemed.indexOf(code);
                if (index > -1) {
                    redeemed.splice(index, 1);
                }
            }
            
            localStorage.setItem('redeemedCodes', JSON.stringify(redeemed));
        }

        // Copy code to clipboard
        async function copyCode(code) {
            try {
                await navigator.clipboard.writeText(code);
                // Visual feedback
                const btn = event.target;
                const originalText = btn.textContent;
                btn.textContent = '✅ Copied!';
                btn.disabled = true;
                
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.disabled = false;
                }, 2000);
            } catch (err) {
                // Fallback for older browsers
                const textArea = document.createElement('textarea');
                textArea.value = code;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
                
                const btn = event.target;
                const originalText = btn.textContent;
                btn.textContent = '✅ Copied!';
                setTimeout(() => {
                    btn.textContent = originalText;
                }, 2000);
            }
        }

        // Force update
        async function updateCodes() {
            const btn = document.querySelector('.refresh-btn');
            btn.textContent = '⏳ Updating...';
            btn.disabled = true;
            
            try {
                const response = await fetch('/api/update', { method: 'POST' });
                
                if (response.ok) {
                    setTimeout(() => location.reload(), 3000);
                    btn.textContent = '✅ Update triggered, reloading...';
                } else {
                    btn.textContent = '❌ Update failed';
                    setTimeout(() => {
                        btn.textContent = '🔄 Force Update';
                        btn.disabled = false;
                    }, 3000);
                }
            } catch (error) {
                btn.textContent = '❌ Network error';
                setTimeout(() => {
                    btn.textContent = '🔄 Force Update';
                    btn.disabled = false;
                }, 3000);
            }
        }

        // Load redeemed codes on page load
        document.addEventListener('DOMContentLoaded', loadRedeemedCodes);
    </script>
</body>
</html>
    """
    
    return html

@app.get("/api/codes")
def api_codes():
    """API endpoint to get raw codes data"""
    data = load_local_codes()
    if data:
        return data
    return {"error": "No codes available", "codes": []}

@app.post("/api/update")
def manual_update(background_tasks: BackgroundTasks):
    """Manual trigger for code update"""
    def update_task():
        success = run_scraper()
        logging.info(f"Manual update {'succeeded' if success else 'failed'}")
    
    background_tasks.add_task(update_task)
    return {"message": "Update triggered"}

@app.get("/api/status")
def status():
    """Get system status"""
    return {
        "local_file_exists": os.path.exists(LOCAL_CODES_PATH),
        "update_interval": UPDATE_INTERVAL
    }