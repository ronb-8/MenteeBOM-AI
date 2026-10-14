# ============================================================
#  MenteeBOM firewall hardening (run ONCE, self-elevating)
#
#  Limits the web ports to the office subnet:
#    - "MenteeBOM allow office"     : inbound TCP 80,5000 from -Subnet  -> Allow
#    - "MenteeBOM block non-office" : inbound TCP 80,5000 from anywhere
#                                     else -> Block (block rules always
#                                     win over allow rules in Windows
#                                     Firewall, so this is the real fence)
#  and DISABLES (does not delete) the broad "python.exe - any port, any
#  address" rules that Windows created from the "Allow access?" popup.
#
#  Usage: right-click -> "Run with PowerShell", accept UAC.
#         .\setup_firewall.ps1 -Subnet 192.168.31.0/24,10.0.0.0/24   (several VLANs)
#         .\setup_firewall.ps1 -Undo   (removes the rules, re-enables the python ones)
#  See docs\BACKUP_SETUP.md (hardening section).
# ============================================================

param(
    # Every network MenteeBOM users come from (seen in logs\prod_server.log):
    # 192.168.30/31/40 = office LAN + Wi-Fi (DC is on .40), 10.212.134 = VPN clients.
    [string[]]$Subnet = @('192.168.30.0/24', '192.168.31.0/24', '192.168.40.0/24', '10.212.134.0/24'),
    [int[]]$Ports = @(80, 5000),
    [switch]$Undo
)

# "-Subnet a,b,c" arrives as ONE string when the script is started with -File (and after
# self-elevation), so always split on commas and validate before touching any rule.
$Subnet = @($Subnet -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$Ports  = @($Ports -split ','  | ForEach-Object { [int]$_ })
foreach ($c in $Subnet) {
    if ($c -notmatch '^\d{1,3}(\.\d{1,3}){3}(/\d{1,2})?$') { Write-Host "Invalid subnet '$c' - expected a.b.c.d/nn"; Read-Host 'Press Enter to close'; exit 1 }
}

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host 'Requesting administrator elevation (needed to change firewall rules)...'
    $elevArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$($MyInvocation.MyCommand.Path)`"",
                  '-Subnet', ($Subnet -join ','), '-Ports', ($Ports -join ','))
    if ($Undo) { $elevArgs += '-Undo' }
    Start-Process powershell.exe -Verb RunAs -ArgumentList $elevArgs
    exit
}

$AllowName = 'MenteeBOM allow office (TCP 80,5000)'
$BlockName = 'MenteeBOM block non-office (TCP 80,5000)'
$pythonRules = Get-NetFirewallRule -Direction Inbound -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -eq 'python.exe' -and $_.Action -eq 'Allow' }

if ($Undo) {
    Remove-NetFirewallRule -DisplayName $AllowName, $BlockName -ErrorAction SilentlyContinue
    $pythonRules | Enable-NetFirewallRule
    Write-Host 'Removed the MenteeBOM rules and re-enabled the python.exe rules.'
    if ($Host.Name -eq 'ConsoleHost' -and -not $env:MENTEEBOM_SETUP_NOPAUSE) { Read-Host 'Press Enter to close' }
    exit
}

# Everything that is NOT in the allowed subnets, expressed as address ranges
# (Windows Firewall has no "not" operator for remote addresses).
function ToIp([int64]$n) {
    return ('{0}.{1}.{2}.{3}' -f (($n -shr 24) -band 255), (($n -shr 16) -band 255), (($n -shr 8) -band 255), ($n -band 255))
}
function Get-ExcludedRanges([string[]]$cidrs) {
    # int64 arithmetic throughout: PowerShell 5.1 has no unsigned shifts.
    $blocks = @(foreach ($c in $cidrs) {
        $ip, $bits = $c.Split('/')
        if (-not $bits) { $bits = 32 }
        $b = [System.Net.IPAddress]::Parse($ip).GetAddressBytes()
        [int64]$addr  = ([int64]$b[0] -shl 24) + ([int64]$b[1] -shl 16) + ([int64]$b[2] -shl 8) + [int64]$b[3]
        [int64]$size  = [int64]1 -shl (32 - [int]$bits)
        [int64]$start = [int64][math]::Floor($addr / $size) * $size
        [pscustomobject]@{ Start = $start; End = $start + $size - 1 }
    }) | Sort-Object Start
    $ranges = @(); [int64]$cursor = 0
    foreach ($b in $blocks) {
        if ($b.Start -gt $cursor) { $ranges += "$(ToIp $cursor)-$(ToIp ($b.Start - 1))" }
        $cursor = $b.End + 1
    }
    if ($cursor -le 4294967295) { $ranges += "$(ToIp $cursor)-255.255.255.255" }
    return $ranges
}

$excluded = Get-ExcludedRanges $Subnet
if (-not $Subnet -or -not $excluded) { Write-Host 'Refusing to continue: empty allow list or empty block list.'; Read-Host 'Press Enter to close'; exit 1 }
Write-Host '============================================='
Write-Host ' MenteeBOM firewall hardening'
Write-Host '============================================='
Write-Host "Ports          : $($Ports -join ', ')"
Write-Host "Allowed from   : $($Subnet -join ', ')"
Write-Host "Blocked ranges : $($excluded -join ', ')"
Write-Host ''

Remove-NetFirewallRule -DisplayName $AllowName, $BlockName -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName $AllowName -Direction Inbound -Action Allow -Protocol TCP `
    -LocalPort $Ports -RemoteAddress $Subnet -Profile Any -Enabled True `
    -Description 'MenteeBOM web server reachable from the office subnet(s) only. setup_firewall.ps1' | Out-Null
New-NetFirewallRule -DisplayName $BlockName -Direction Inbound -Action Block -Protocol TCP `
    -LocalPort $Ports -RemoteAddress $excluded -Profile Any -Enabled True `
    -Description 'Blocks MenteeBOM web ports from outside the office subnet(s). setup_firewall.ps1' | Out-Null
Write-Host "Created: $AllowName"
Write-Host "Created: $BlockName"

if ($pythonRules) {
    $pythonRules | Disable-NetFirewallRule
    foreach ($r in $pythonRules) { Write-Host "Disabled broad rule: $($r.Name)" }
} else {
    Write-Host 'No broad python.exe allow rules found.'
}

Write-Host ''
Write-Host 'Done! Current MenteeBOM rules:'
Get-NetFirewallRule -DisplayName 'MenteeBOM*' | Format-Table DisplayName, Enabled, Action, Profile -AutoSize
if ($Host.Name -eq 'ConsoleHost' -and -not $env:MENTEEBOM_SETUP_NOPAUSE) { Read-Host 'Press Enter to close' }
