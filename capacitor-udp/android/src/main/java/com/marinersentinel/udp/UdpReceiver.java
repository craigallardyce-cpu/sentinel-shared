package com.marinersentinel.udp;

import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetSocketAddress;
import java.net.SocketException;
import java.nio.charset.StandardCharsets;

/**
 * One bound UDP port and the thread that reads it.
 *
 * Plain java.net, with nothing from Android or Capacitor, so it can be tested
 * on any JVM. The plugin wraps it with the Wi-Fi multicast lock and the bridge.
 *
 * Bound on every interface with address reuse, as the desktop binds
 * (`dgram.createSocket({ type: 'udp4', reuseAddr: true })`), so HarborSentinel
 * and OceanSentinel on one phone can both listen to the same gateway port and
 * both receive its broadcast.
 */
final class UdpReceiver {

    interface Listener {
        /** A datagram arrived, decoded as UTF-8. Called on the receive thread. */
        void onDatagram(String address, String data);

        /** The socket failed after binding. Called once, on the receive thread. */
        void onError(String message);
    }

    /** The largest payload a UDP datagram can carry over IPv4. */
    private static final int MAX_DATAGRAM = 65507;

    private final DatagramSocket socket;
    private final Thread thread;
    private volatile boolean closed = false;

    private UdpReceiver(DatagramSocket socket, Listener listener, String name) {
        this.socket = socket;
        this.thread = new Thread(() -> run(listener), name);
        this.thread.setDaemon(true);
    }

    /** Binds `port` and starts reading. Throws when the port cannot be bound. */
    static UdpReceiver open(int port, Listener listener) throws SocketException {
        if (port < 1 || port > 65535) {
            throw new SocketException("Not a UDP port: " + port);
        }
        DatagramSocket socket = new DatagramSocket(null);
        try {
            socket.setReuseAddress(true);
            socket.setBroadcast(true);
            socket.bind(new InetSocketAddress(port));
        } catch (SocketException e) {
            socket.close();
            throw e;
        }
        UdpReceiver receiver = new UdpReceiver(socket, listener, "SentinelUdp-" + port);
        receiver.thread.start();
        return receiver;
    }

    int localPort() {
        return socket.getLocalPort();
    }

    /** Stops reading and frees the port. Safe to call more than once. */
    void close() {
        closed = true;
        socket.close();
    }

    private void run(Listener listener) {
        byte[] buffer = new byte[MAX_DATAGRAM];
        while (!closed) {
            DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
            try {
                socket.receive(packet);
            } catch (IOException e) {
                // close() unblocks receive() with an exception; that is not a failure.
                if (!closed) {
                    closed = true;
                    socket.close();
                    String message = e.getMessage();
                    listener.onError(message != null ? message : "UDP socket failed");
                }
                return;
            }
            String address = packet.getAddress() != null ? packet.getAddress().getHostAddress() : "";
            // An IPv6 scope (fe80::1%wlan0) is not part of the address the person typed.
            int scope = address.indexOf('%');
            if (scope >= 0) address = address.substring(0, scope);
            String data = new String(packet.getData(), packet.getOffset(), packet.getLength(), StandardCharsets.UTF_8);
            try {
                listener.onDatagram(address, data);
            } catch (RuntimeException e) {
                // A listener fault must not stop the feed.
            }
        }
    }
}
