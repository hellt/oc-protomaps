# OpenConfig Proto Maps

**Open the app:** https://protomap.netdevops.me/

Interactive maps for OpenConfig gNxI protobuf services.

The app helps you inspect how OpenConfig services, RPCs, messages, enums, fields, and external
protobuf types relate to each other. It currently includes maps for gNMI, gNOI, gNSI, and gRIBI.

## Available Maps

All maps are available in the app:

- gNMI
- gNOI
- gNSI
- gRIBI

## Using The App

- Choose a service family with the top navigation.
- Select a concrete service from the service selector.
- Use the RPC selector to focus the map on one RPC.
- Search for messages, fields, enums, groups, or badges.
- Open protobuf source links from nodes where available.
- Toggle extension relationships and deprecated fields/types from the view menu.
- Export the current view as PDF or SVG.
- Share the current view with the browser URL.

Deprecated fields and types are hidden by default. Extension relationships are also hidden by
default to keep the first view focused.

## Run Locally

```bash
pnpm install
pnpm run dev
```

Open the Vite URL printed in the terminal.

For a production build:

```bash
pnpm run build
pnpm run preview
```

## Notes

- The app uses checked-in generated map data and does not fetch protobuf files at runtime.
- Protobuf and specification links open the relevant upstream OpenConfig sources.
