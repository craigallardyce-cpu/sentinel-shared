package com.marinersentinel.udp;

import android.content.Context;
import android.net.wifi.WifiManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.net.SocketException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * UDP input for the fleet's Android apps: listen on a port for what an NMEA
 * gateway broadcasts. The JavaScript half is `@sentinel/capacitor-udp`.
 *
 * Receive only, as the desktop's UDP input is. Each datagram goes to the page as
 * a `datagram` event; splitting it into sentences happens there, so the phone
 * and the desktop split in the same code.
 *
 * While any listener is open the plugin holds a Wi-Fi multicast lock. Without
 * it many phones filter broadcast and multicast packets out on the Wi-Fi chip,
 * and a gateway's broadcast never arrives. The lock costs battery, so it is
 * released as soon as the last listener closes.
 */
@CapacitorPlugin(name = "SentinelUdp")
public class SentinelUdpPlugin extends Plugin {

    private final Map<Integer, UdpReceiver> receivers = new HashMap<>();
    private int nextId = 1;
    private WifiManager.MulticastLock multicastLock;

    @PluginMethod
    public void listen(PluginCall call) {
        Integer port = call.getInt("port");
        if (port == null || port < 1 || port > 65535) {
            call.reject("A UDP port from 1 to 65535 is needed");
            return;
        }

        final int id;
        synchronized (this) {
            id = nextId++;
        }

        UdpReceiver receiver;
        try {
            receiver = UdpReceiver.open(port, new UdpReceiver.Listener() {
                @Override
                public void onDatagram(String address, String data) {
                    JSObject event = new JSObject();
                    event.put("id", id);
                    event.put("address", address);
                    event.put("data", data);
                    notifyListeners("datagram", event);
                }

                @Override
                public void onError(String message) {
                    synchronized (SentinelUdpPlugin.this) {
                        receivers.remove(id);
                        releaseLockIfIdle();
                    }
                    JSObject event = new JSObject();
                    event.put("id", id);
                    event.put("message", message);
                    notifyListeners("error", event);
                }
            });
        } catch (SocketException e) {
            call.reject("Could not listen on UDP port " + port + ": " + e.getMessage());
            return;
        }

        synchronized (this) {
            receivers.put(id, receiver);
            acquireLock();
        }
        JSObject result = new JSObject();
        result.put("id", id);
        call.resolve(result);
    }

    @PluginMethod
    public void close(PluginCall call) {
        Integer id = call.getInt("id");
        UdpReceiver receiver = null;
        synchronized (this) {
            if (id != null) receiver = receivers.remove(id);
            releaseLockIfIdle();
        }
        if (receiver != null) receiver.close();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        List<UdpReceiver> open;
        synchronized (this) {
            open = new ArrayList<>(receivers.values());
            receivers.clear();
            releaseLockIfIdle();
        }
        for (UdpReceiver receiver : open) receiver.close();
        super.handleOnDestroy();
    }

    /** Called with the plugin's lock held. */
    private void acquireLock() {
        if (multicastLock == null) {
            WifiManager wifi = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wifi == null) return; // No Wi-Fi on this device: listen without it.
            multicastLock = wifi.createMulticastLock("SentinelUdp");
            multicastLock.setReferenceCounted(false);
        }
        if (!multicastLock.isHeld()) multicastLock.acquire();
    }

    /** Called with the plugin's lock held. */
    private void releaseLockIfIdle() {
        if (receivers.isEmpty() && multicastLock != null && multicastLock.isHeld()) {
            multicastLock.release();
        }
    }
}
