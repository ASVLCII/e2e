---
'@e2e-dev/mobile': minor
---

A device provider can record the attempts it serves: `DeviceProvider.record(lease, context)` starts the service's own recording of the leased device, and its file or link becomes the attempt's video in place of agent-device's recording. The worker now knows the lease id its slot rides, so `record` gets the lease as it traveled. A provider that cannot record leaves `record` out.
