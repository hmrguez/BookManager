package com.hmrguez.wovenleaf;

import android.app.*;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.*;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Opt-in, visible connection to the companion on this phone; never binds Wi-Fi. */
public final class LibbyConnectionService extends Service {
    static volatile boolean running;
    private volatile ServerSocket server;
    private volatile boolean closed;
    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public void onCreate() {
        super.onCreate();
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel("libby-connection", "Libby connection", NotificationManager.IMPORTANCE_LOW));
        PendingIntent open = PendingIntent.getActivity(this, 43187, new Intent(this, MainActivity.class), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop = PendingIntent.getService(this, 43188, new Intent(this, LibbyConnectionService.class).setAction("stop"), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new Notification.Builder(this, "libby-connection").setSmallIcon(R.drawable.ic_stat_wovenleaf)
            .setContentTitle("Libby connection is on").setContentText("Receives captures from your browser on this phone.")
            .setContentIntent(open).setOngoing(true).setVisibility(Notification.VISIBILITY_SECRET)
            .addAction(new Notification.Action.Builder(null, "Pause", stop).build()).build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(43187, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(43187, notification);
        new Thread(this::listen, "wovenleaf-libby-local").start();
    }
    @Override public int onStartCommand(Intent intent, int flags, int id) {
        if (intent != null && "stop".equals(intent.getAction())) { LibbyConnection.pause(this, true); stopSelf(); return START_NOT_STICKY; }
        if (!LibbyConnection.enabled(this) || LibbyConnection.paused(this) || (!LibbyConnection.paired() && !LibbyConnection.pairing())) { stopSelf(); return START_NOT_STICKY; }
        return START_STICKY;
    }
    private void listen() {
        try (ServerSocket socket = new ServerSocket()) {
            server = socket; socket.setReuseAddress(true);
            socket.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), LibbyConnection.PORT), 4);
            socket.setSoTimeout(10000);
            running = true; LibbyConnection.error = null; LibbyConnection.signal();
            while (!closed) {
                if (!LibbyConnection.paired() && !LibbyConnection.pairing()) break;
                try (Socket client = socket.accept()) { client.setSoTimeout(2000); handle(client); }
                catch (Exception ignored) { /* Reject malformed/unauthenticated requests without logging payloads. */ }
            }
        } catch (Exception e) { if (!closed) LibbyConnection.error = "The local connection could not start. Try connecting again."; }
        finally { running = false; LibbyConnection.signal(); stopSelf(); }
    }
    private void handle(Socket client) throws Exception {
        InputStream input = new BufferedInputStream(client.getInputStream());
        String[] request = line(input, 2048).split(" ");
        if (request.length != 3 || !request[2].equals("HTTP/1.1")) return;
        Map<String, String> headers = new HashMap<>(); int count = 0;
        while (true) {
            String header = line(input, 2048); count += header.length();
            if (count > 8192) return; if (header.isEmpty()) break;
            int split = header.indexOf(':'); if (split < 1) return;
            String name = header.substring(0, split).toLowerCase(Locale.ROOT);
            if (headers.put(name, header.substring(split + 1).trim()) != null) return;
        }
        String origin = headers.get("origin");
        if (!LibbyConnection.extensionOrigin(origin) || !headers.getOrDefault("host", "").equals("127.0.0.1:" + LibbyConnection.PORT) || headers.containsKey("transfer-encoding")) return;
        if (!Set.of("/v1/pair", "/v1/capture").contains(request[1])) { reply(client, origin, 404, "{}"); return; }
        if (request[0].equals("OPTIONS")) { reply(client, origin, 204, ""); return; }
        if (!request[0].equals("POST") || !headers.getOrDefault("content-type", "").equals("application/json")) { reply(client, origin, 400, "{}"); return; }
        int length = Integer.parseInt(headers.getOrDefault("content-length", "0"));
        if (length < 1 || length > LibbyConnection.MAX_WIRE) { reply(client, origin, 400, "{}"); return; }
        byte[] body = new byte[length]; new DataInputStream(input).readFully(body);
        try { JSONObject result = LibbyConnection.request(this, request[1], origin, new String(body, StandardCharsets.UTF_8)); reply(client, origin, 200, result.toString()); }
        catch (Exception e) { reply(client, origin, 403, "{}"); }
    }
    private static String line(InputStream input, int max) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream(); int previous = -1;
        for (int i = 0; i < max; i++) {
            int next = input.read(); if (next < 0 || next > 127) throw new IOException();
            if (next == '\n') { if (previous != '\r') throw new IOException(); byte[] bytes = out.toByteArray(); return new String(bytes, 0, bytes.length - 1, StandardCharsets.US_ASCII); }
            out.write(next); previous = next;
        }
        throw new IOException();
    }
    private static void reply(Socket socket, String origin, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        String headers = "HTTP/1.1 " + status + " Result\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nConnection: close\r\nAccess-Control-Allow-Origin: " + origin + "\r\nVary: Origin\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nAccess-Control-Allow-Headers: content-type\r\nAccess-Control-Allow-Private-Network: true\r\nContent-Length: " + bytes.length + "\r\n\r\n";
        OutputStream output = socket.getOutputStream(); output.write(headers.getBytes(StandardCharsets.US_ASCII)); output.write(bytes); output.flush();
    }
    @Override public void onDestroy() {
        closed = true; running = false;
        try { if (server != null) server.close(); } catch (IOException ignored) { }
        LibbyConnection.signal(); super.onDestroy();
    }
}
