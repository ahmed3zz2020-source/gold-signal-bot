# setup_mcp_key.ps1 — copy the MCP key from the clipboard into the .env
#
# In MetaTrader 5: Tools > Options > MCP -> press the Copy button next to the
# API Key, then run GET-MCP-KEY.bat. This script reads the clipboard, finds the
# token + the server address, and writes them into the .env file.

$ErrorActionPreference = "Continue"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
$envFile = Join-Path $root ".env"

Write-Host ""
Write-Host "  reading the clipboard..."
Write-Host ""

$clip = ""
try {
    $clip = Get-Clipboard -Raw
} catch {
    Write-Host "  cannot read the clipboard (run this from your desktop session)"
}
if (-not $clip) { $clip = "" }

$url = ""
$key = ""

# 1) the usual JSON config block
$m = [regex]::Match($clip, 'http://127\.0\.0\.1:\d+/mcp')
if ($m.Success) { $url = $m.Value }
$m = [regex]::Match($clip, 'Bearer\s+([A-Za-z0-9_\-+/=]{20,})')
if ($m.Success) { $key = $m.Groups[1].Value }

# 2) a bare token
if (-not $key) {
    $m = [regex]::Match($clip.Trim(), '^([A-Za-z0-9_\-+/=]{30,})$')
    if ($m.Success) { $key = $m.Groups[1].Value }
}
if (-not $url) { $url = "http://127.0.0.1:22346/mcp" }

if (-not $key) {
    Write-Host "  the clipboard does not contain the MCP key."
    Write-Host ""
    Write-Host "  do it like this:"
    Write-Host "    1) open MetaTrader 5 -> Tools -> Options -> MCP"
    Write-Host "    2) press the Copy button next to the API Key"
    Write-Host "    3) come back and run GET-MCP-KEY.bat again"
    Write-Host ""
    Write-Host "  or paste it by hand: open the .env in Notepad and put it on the line"
    Write-Host "    MT5_MCP_KEY=...the key..."
    Write-Host ""
    exit 1
}

# ---- write it into the .env (keep every other line) ----
$lines = @()
if (Test-Path $envFile) { $lines = Get-Content $envFile }
else { Write-Host "  .env not found - creating it" }

$out = @()
$doneUrl = $false; $doneKey = $false
foreach ($l in $lines) {
    if ($l -match '^MT5_MCP_URL=') { $out += "MT5_MCP_URL=$url"; $doneUrl = $true }
    elseif ($l -match '^MT5_MCP_KEY=') { $out += "MT5_MCP_KEY=$key"; $doneKey = $true }
    else { $out += $l }
}
if (-not $doneUrl) { $out += ""; $out += "MT5_MCP_URL=$url" }
if (-not $doneKey) { $out += "MT5_MCP_KEY=$key" }

Set-Content -Path $envFile -Value $out -Encoding UTF8

Write-Host "  OK - written into the .env:"
Write-Host "    MT5_MCP_URL=$url"
Write-Host ("    MT5_MCP_KEY=" + $key.Substring(0, [Math]::Min(8, $key.Length)) + "..." + $key.Length + " chars")
Write-Host ""
Write-Host "  now run MCP-TEST.bat"
Write-Host ""
exit 0
