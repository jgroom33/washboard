# Washboard Drag

A welded steel drag, towed behind a pickup, that cuts washboard out of a gravel driveway. It carries 600 lb or more of logs, concrete blocks, or gravel on a 3/16" deck. All structural steel is one size of angle iron.

**Site:** https://jgroom33.github.io/washboard/

The site has a pannable 3D model, printable plan and side drawings, a cut list, an order list with a cutting plan, the build sequence, towing notes, and the load calculations. Pick 48, 60, or 72 inches wide and everything recomputes.

## How it is built

`js/spec.js` is the only place the design lives. Each part carries its stock, cut length, and a 2D profile extruded along one axis. The 3D viewer (`js/viewer.js`, Three.js), the SVG drawings (`js/drawings.js`), and the tables (`js/tables.js`) all read that one object, so the model and the cut list cannot disagree. `verify()` checks the geometry closes up and the pieces nest into the stock sticks.

No build step. Three.js loads from a CDN through an import map.

## Run locally

ES modules do not load from `file://`, so serve the folder:

```
python3 -m http.server 8000
```

then open http://localhost:8000.

Check the spec from the command line:

```
node -e "import('./js/spec.js').then(m => console.log(m.verify(m.buildSpec(60))))"
```
