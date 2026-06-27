# Stereogram Generator

Standalone GitHub Pages app for generating patterned single-image stereograms from:

- a pattern image, bitmap or SVG/vector
- a hidden 3D image supplied as a depth map

All processing happens in-browser with Canvas. No server is needed.

## Use

1. Open `index.html` locally or publish this folder with GitHub Pages.
2. Upload a pattern image.
3. Upload a depth map. By default, white is interpreted as nearer for inward viewing.
4. Adjust output size, encoded image size, tile width, depth strength, depth blur/depth of field, projection direction, and pattern controls.
5. Click **Generate stereogram**.
6. Click **Save PNG**.

## GitHub Pages

Push these files to a repository, then enable **Settings → Pages → Deploy from branch** and select the branch/folder containing `index.html`.
