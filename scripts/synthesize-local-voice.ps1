param(
  [Parameter(Mandatory = $true)][string]$TextFile,
  [Parameter(Mandatory = $true)][string]$OutputFile,
  [int]$Rate = -1,
  [string]$Voice = "",
  [switch]$Song
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech
$text = [System.IO.File]::ReadAllText($TextFile)
if ([string]::IsNullOrWhiteSpace($text)) { throw "Narration text is empty." }

$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  if (-not [string]::IsNullOrWhiteSpace($Voice)) {
    $speaker.SelectVoice($Voice)
  } else {
    $friendlyVoice = $speaker.GetInstalledVoices() |
      ForEach-Object { $_.VoiceInfo } |
      Where-Object { $_.Culture.Name -like "en-*" -and $_.Gender -eq "Female" } |
      Select-Object -First 1
    if ($friendlyVoice) { $speaker.SelectVoice($friendlyVoice.Name) }
  }
  $speaker.Rate = [Math]::Max(-3, [Math]::Min(2, $Rate))
  $speaker.Volume = 100
  $speaker.SetOutputToWaveFile($OutputFile)
  if ($Song) {
    $lines = @($text -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    # Keep pitch natural: synthetic pitch jumps sound ghostly on laptop voices.
    # Tiny changes in delivery speed provide a rhythmic chant while the original
    # instrumental arrangement carries the melody.
    $rates = @("+2%", "0%", "+1%", "-1%")
    $body = New-Object System.Text.StringBuilder
    for ($index = 0; $index -lt $lines.Count; $index++) {
      $escaped = [System.Security.SecurityElement]::Escape($lines[$index].Trim())
      $lineRate = $rates[$index % $rates.Count]
      [void]$body.Append("<prosody rate='$lineRate' pitch='0%'>$escaped</prosody><break time='95ms'/>")
    }
    $ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>$body</speak>"
    $speaker.SpeakSsml($ssml)
  } else {
    $speaker.Speak($text)
  }
} finally {
  $speaker.Dispose()
}
