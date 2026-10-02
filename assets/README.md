# Optional assets

This directory is for optional media the pipeline may reference:

- `matteo.jpg` — optional mascot cameo used when the `mascot` flag is set. The
  code checks if the file exists and splices a short clip into the B-roll.
  Drop your own image here if you want the cameo; do not commit copyrighted or
  trademarked images to the repo.

No assets are required. The pipeline works out of the box with stock footage and
AI-generated visuals.

`influencers.json` is the default roster of **fictional** phone-creator hosts
for the `ugc-talking-head` format (name, persona, voice id, face prompt,
optional HeyGen avatar id). Runtime edits and generated portraits go in
`data/influencers.json` and `data/influencers/`, which are gitignored. Do not
commit a real person's face or a celebrity likeness.
