# Interactive map for OpenConfig gRPC services

<https://protomap.netdevops.me/>

> Demo: <https://www.youtube.com/watch?v=FsVc0eHzyJw>

The app helps you inspect how OpenConfig services, RPCs, messages, enums, fields, and external
protobuf types relate to each other. It currently includes maps for gNMI, gNOI, gNSI, and gRIBI.

## Available Maps

All maps are available in the app:

- gNMI
- gNOI
- gNSI
- gRIBI

## Run Locally

```bash
pnpm install
pnpm run dev
```

## Build

For a production build:

```bash
pnpm run build
pnpm run preview
```

To refresh the checked-in generated map data from upstream OpenConfig tags:

```bash
pnpm run build:map
```

The repository also includes a weekly GitHub Actions updater.

## Notes

- The app uses checked-in generated map data and does not fetch protobuf files at runtime.
- Protobuf and specification links open the relevant upstream OpenConfig sources.
