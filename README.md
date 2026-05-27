# gNMI Map
![map](https://gitlab.com/rdodin/pics/-/wikis/uploads/6a9d18f9cb2240656aad5d224aa757df/rsz_image.png)

gNMI Map provides a visual representation of the [gNMI](https://github.com/openconfig/reference/blob/master/rpc/gnmi/gnmi-specification.md) service.

It contains all the RPCs, messages and custom types defined in the [gnmi.proto](https://github.com/openconfig/gnmi/blob/master/proto/gnmi/gnmi.proto) file mapped as a block diagram with inter-message relationship.

gNMI Map makes it easy to understand the composition of the gNMI service as well as it provides the relevant links to the documentation and proto references.

<p align=center><img src="https://gitlab.com/rdodin/pics/-/wikis/uploads/61e7fa143e5898653c1edb9b42b936f3/image.png" width="600" /></p>

## React Flow map

This repository now includes a React Flow recreation of the latest tagged upstream gNMI protobuf IDL. The app currently tracks `openconfig/gnmi` release `v0.14.1`, whose `gnmi.proto` advertises gNMI service compatibility `0.10.0`. It adds an interactive canvas with search, field-level links, source/documentation links, an extension-edge toggle, a deprecated-field toggle, and in-browser PDF/SVG export for the current filter selection. Deprecated proto fields are hidden by default so the map follows the current spec-facing surface.

The React app is structured around a gNxI service registry. gNMI uses the curated legacy map, while gNOI, gNSI, and gRIBI are generated from the latest tagged OpenConfig protobufs and are selectable from the top navigation. Multi-service families render one concrete service at a time through the service selector, keeping large families such as gNOI responsive.

```bash
pnpm install
pnpm run dev
```

Open the dev-server URL printed by Vite. For a production build:

```bash
pnpm run build
```

## GitHub Pages

The React Flow map deploys to GitHub Pages through `.github/workflows/pages.yml`.
The workflow runs on pushes to `master` and can also be started manually from the Actions tab.

Enable Pages in the repository settings with **Source: GitHub Actions**. After deployment, the default project Pages URL is:

```text
https://hellt.github.io/gnmi-map/
```

The workflow builds the Vite app into `dist/` and uses the Pages base path when generating asset URLs, so the app works under `/gnmi-map/`.

To refresh the generated React Flow map from the latest `openconfig/gnmi` tag:

```bash
pnpm run build:map
pnpm run build:service-maps
pnpm run test:map
```

Proto links are pinned to the latest gNMI tag. Specification links track `openconfig/reference` `master`, since that repository does not publish tags.

## Usage
Use the service, version, RPC, extension, and deprecated controls to choose the visible map surface. The toolbar exports that current filtered layout as PDF or as a transparent SVG without storing generated files in the repository.
