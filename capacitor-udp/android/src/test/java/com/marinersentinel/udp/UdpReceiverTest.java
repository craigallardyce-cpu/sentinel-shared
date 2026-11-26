package com.marinersentinel.udp;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.SocketException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import org.junit.Test;

/** Runs on the JVM (`gradlew test`): real sockets on the loopback interface. */
public class UdpReceiverTest {

    private static final class Collector implements UdpReceiver.Listener {
        final BlockingQueue<String> datagrams = new LinkedBlockingQueue<>();
        final BlockingQueue<String> errors = new LinkedBlockingQueue<>();

        @Override
        public void onDatagram(String address, String data) {
            datagrams.add(address + "|" + data);
        }

        @Override
        public void onError(String message) {
            errors.add(message);
        }
    }

    private static int freePort() throws Exception {
        try (DatagramSocket probe = new DatagramSocket(0)) {
            return probe.getLocalPort();
        }
    }

    private static void send(int port, String text) throws Exception {
        try (DatagramSocket out = new DatagramSocket()) {
            byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
            out.send(new DatagramPacket(bytes, bytes.length, InetAddress.getLoopbackAddress(), port));
        }
    }

    @Test
    public void deliversEachDatagramWithItsSender() throws Exception {
        int port = freePort();
        Collector collector = new Collector();
        UdpReceiver receiver = UdpReceiver.open(port, collector);
        try {
            send(port, "$GPRMC,1*00\r\n$IIDBT,2*00\r\n");
            String got = collector.datagrams.poll(5, TimeUnit.SECONDS);
            assertEquals("127.0.0.1|$GPRMC,1*00\r\n$IIDBT,2*00\r\n", got);
        } finally {
            receiver.close();
        }
    }

    @Test
    public void twoListenersShareOnePort() throws Exception {
        int port = freePort();
        Collector first = new Collector();
        Collector second = new Collector();
        UdpReceiver a = UdpReceiver.open(port, first);
        UdpReceiver b = UdpReceiver.open(port, second);
        try {
            assertEquals(port, a.localPort());
            assertEquals(port, b.localPort());
        } finally {
            a.close();
            b.close();
        }
    }

    @Test
    public void closeIsQuietAndFreesThePort() throws Exception {
        int port = freePort();
        Collector collector = new Collector();
        UdpReceiver receiver = UdpReceiver.open(port, collector);
        receiver.close();
        receiver.close();
        Thread.sleep(200);
        assertTrue(collector.errors.isEmpty());
        try (DatagramSocket again = new DatagramSocket(port)) {
            assertEquals(port, again.getLocalPort());
        }
    }

    @Test
    public void refusesAPortOutOfRange() {
        try {
            UdpReceiver.open(70000, new Collector());
            fail("expected a refusal");
        } catch (SocketException expected) {
            assertTrue(expected.getMessage().contains("70000"));
        }
    }
}
