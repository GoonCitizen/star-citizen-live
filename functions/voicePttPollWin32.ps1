param(
  [Parameter(Mandatory = $true)][int]$Main,
  [string]$ShiftKeys = '',
  [string]$AltKeys = '',
  [string]$CtrlKeys = '',
  [string]$MetaKeys = ''
)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class GoonCitizenPtt {
  [DllImport("user32.dll")]
  public static extern short GetAsyncKeyState(int vKey);
}
"@

function Parse-Group([string]$raw) {
  if ([string]::IsNullOrWhiteSpace($raw)) { return @() }
  return @($raw.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' } | ForEach-Object { [int]$_ })
}

function Group-Down([int[]]$codes) {
  if ($null -eq $codes -or $codes.Length -eq 0) { return $true }
  foreach ($code in $codes) {
    if (([GoonCitizenPtt]::GetAsyncKeyState($code) -band 0x8000) -ne 0) { return $true }
  }
  return $false
}

$shift = Parse-Group $ShiftKeys
$alt = Parse-Group $AltKeys
$ctrl = Parse-Group $CtrlKeys
$meta = Parse-Group $MetaKeys
$last = -1

while ($true) {
  $held = (([GoonCitizenPtt]::GetAsyncKeyState($Main) -band 0x8000) -ne 0)
  if ($held) { $held = Group-Down $shift }
  if ($held) { $held = Group-Down $alt }
  if ($held) { $held = Group-Down $ctrl }
  if ($held) { $held = Group-Down $meta }
  $bit = if ($held) { 1 } else { 0 }
  if ($bit -ne $last) {
    Write-Output $bit
    [Console]::Out.Flush()
    $last = $bit
  }
  Start-Sleep -Milliseconds 40
}
