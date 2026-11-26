# @sentinel/capacitor-udp

UDP NMEA input for HarborSentinel and OceanSentinel on a standalone Android
phone or tablet (roadmap #86).

Many gateways broadcast their NMEA over UDP. TCP gives each device its own
connection, and most gateways allow only three or four; UDP lets any number of
phones and tablets hear the same broadcast with no desktop in between. The
desktop has had UDP input since 2.14 (in `@sentinel/marine`'s pool, through
Node's `dgram`). A phone had none, because the TCP socket plugin the apps use
(`@spryrocks/capacitor-socket-connection-plugin`) has no UDP and no maintained
Capacitor 8 UDP plugin exists.

## What is in it

- **The native plugin**, `android/`, registered as `SentinelUdp` (Java package
  `com.marinersentinel.udp`), two small classes:
  - `listen({ port })` binds the port on every interface, with address reuse so
    both apps on one phone can listen to the same gateway, and answers `{ id }`.
  - `close({ id })` frees it.
  - Each datagram arrives as a `datagram` event (`{ id, address, data }`). A
    socket that fails after binding sends one `error` event.
  - While any listener is open it holds a Wi-Fi **multicast lock**. Without it
    many phones filter broadcast and multicast packets out on the Wi-Fi chip and
    the gateway's broadcast never arrives. Released when the last listener
    closes, because it costs battery.
  - Its manifest adds `CHANGE_WIFI_MULTICAST_STATE`, a normal permission: granted
    at install, no prompt. It merges into each app's manifest by itself.
  - Receive only, as the desktop's UDP input is.
- **`CapacitorUdpClient`**, with the same `connect(host, port, onData, onError,
  onClose)` / `disconnect()` / `send()` shape as each app's TCP client, so a call
  site picks a client by protocol and changes nothing else. It splits datagrams
  and filters the same way the desktop does: each datagram on its own, `$` and
  `!` lines only, the address (when given) as a filter on the sender, and 15
  seconds of silence ending the listener through `onError` so the app's
  reconnect rebinds it.
- **`listenForSentences({ host, port, durationMs })`**, the Settings "Test"
  under UDP: listens for five seconds and answers how many sentences arrived.
- **`isUdpAvailable()`**: true only in a native build that carries the plugin,
  which today is Android. iOS answers false (receiving broadcast there needs
  Apple's multicast networking entitlement, a separate request to Apple).

## How the apps take it

1. `"@sentinel/capacitor-udp": "file:../sentinel-shared/capacitor-udp"` in
   `dependencies`.
2. `npx cap sync android`, which finds the plugin through its `capacitor` key
   and adds it to `android/capacitor.settings.gradle` and
   `android/app/capacitor.build.gradle`. Those two generated files are committed
   in each app.
3. No new Vite alias: the only runtime import is `@capacitor/core`, which every
   app already aliases.

## Testing

- `npm test`: the client against a fake plugin (vitest).
- `android/src/test`: `UdpReceiver` on real loopback sockets, plain JUnit, runs
  with `gradlew test` from an app's `android/` folder.
- On a boat: two Android phones and a gateway set to broadcast, both phones in
  Standalone mode with Connection type UDP and the gateway's port. Both should
  show live data at once, and the watch should report the feed lost within
  about 15 seconds of the gateway being switched off.
