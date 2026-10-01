# MoneyPrinterTurbo local adjustments

Phoenix's optional stock renderer is the MIT-licensed [MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo) project.

This folder preserves the local laptop-safety adjustments without committing credentials, model weights or the entire dependency checkout. The patch is based on commit `3ade9fbc40e18db32a5edb340d49e31ea0dd5528`.

## Reproduce

In a separate dependency folder:

```powershell
git clone https://github.com/harry0703/MoneyPrinterTurbo.git
cd MoneyPrinterTurbo
git checkout 3ade9fbc40e18db32a5edb340d49e31ea0dd5528
git apply --check C:/path/to/PhoenixStudio/integrations/moneyprinterturbo-local.patch
git apply C:/path/to/PhoenixStudio/integrations/moneyprinterturbo-local.patch
```

Follow that repository's Python/FFmpeg setup instructions. Copy its cleaned `config.example.toml` to `config.toml`, keep Ollama selected, and configure only your free stock keys locally. Bind the API to loopback (`127.0.0.1:8080`). The patched release compose file instead mounts a private `mpt.local.toml` file; normal Python startup reads `config.toml`.

Phoenix's pre-render footage search and the backend renderer are separate processes. Set `PEXELS_API_KEY` in Phoenix's private `.env.local` for searching/previewing, and configure the backend's Pexels key in its private `config.toml` for downloading the approved asset. One application's configuration does not automatically configure the other. Do not commit either filled file.

The patch limits API render threads to one, uses 720p output and low-impact intermediate encodes, sets below-normal process priority on Windows, limits concurrent tasks to one, and uses local Ollama in the example configuration. Phoenix submits explicit local stock requests and never selects the dependency's paid visual-generation providers.

It also adds `phoenix_storyboard` to video requests: exact narration coverage, caption-timed sections, section-specific stock searches, bounded streaming downloads, no global footage loop, and one-process FFmpeg timeline assembly. Source pages and section timings are retained in the task/review record. Run `.venv/Scripts/python.exe -m unittest test.services.test_phoenix_storyboard` from the dependency folder to check this path. Restart the backend after applying an update; Phoenix checks the API schema before accepting new storyboard jobs.

The `PhoenixStoryBeat.assetId` field now locks an approved section to one exact Pexels asset. Its metadata is resolved server-side; no arbitrary client media URL is accepted. An approved download failure or insufficient footage stops that section rather than substituting another clip. The draft approval and free singing setup are documented in [FREE-CREATION.md](FREE-CREATION.md).

New stock creation also requires `phoenix_artifacts_version: 1`. Its completed-task
response includes `phoenix_artifacts`: clean video, caption file, narration file,
actual music presence and optional retained music source. The clean master uses
the uncaptioned picture and the exact final audio streams, copied without a second
picture encode. Missing timed subtitles fail the required-artifact step. Phoenix
stages these files under its Review Files folder and validates them before READY.
This protocol disables automatic cross-posting for Phoenix requests regardless of
the dependency's optional publishing configuration. Restart the backend after
applying the patch; the web app checks that the new field is advertised.

Artifact tests: `.venv/Scripts/python.exe -m unittest test.services.test_phoenix_artifacts`.
To mechanically refresh the bundled patch from the reviewed local files, run
`node scripts/export-backend-patch.cjs --write` in PhoenixStudio (optional
`PHOENIX_MPT_DIR` selects the backend folder). Without `--write`, the script checks
the snapshot. It uses an explicit source-file allowlist, leaves the backend index
alone, excludes private configuration/media, and reverse-checks the result.

The dashboard's approved-footage picker currently uses Pexels. The dependency's other stock integrations do not imply that Pixabay is available in this picker. Its local singing adapter is a different optional service; MoneyPrinterTurbo is not the children's singing engine.

The dependency supports other providers; these are not required or enabled by Phoenix. Do not add paid keys to its configuration for this workflow. Original dependency licence: [MoneyPrinterTurbo-LICENSE](MoneyPrinterTurbo-LICENSE).

To check the patch on an already patched copy, use `git apply --reverse --check` (this verifies only; it does not reverse anything).

These local backend adjustments are versioned here as source, not pushed to the upstream maintainer's repository.
