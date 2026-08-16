package vc.goon.android;

import android.app.Activity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanner;
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning;

/**
 * One-shot QR scan via Google Play services code scanner (Pixel / GMS devices).
 * Used to open {@code fabric://link} device-link offers from the dashboard header.
 */
@CapacitorPlugin(name = "FabricQrScanner")
public class FabricQrScannerPlugin extends Plugin {
  @PluginMethod
  public void status(PluginCall call) {
    JSObject out = new JSObject();
    out.put("available", getActivity() != null);
    call.resolve(out);
  }

  @PluginMethod
  public void scan(PluginCall call) {
    final Activity activity = getActivity();
    if (activity == null) {
      call.reject("no activity");
      return;
    }
    try {
      GmsBarcodeScannerOptions options = new GmsBarcodeScannerOptions.Builder()
        .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
        .enableAutoZoom()
        .build();
      GmsBarcodeScanner scanner = GmsBarcodeScanning.getClient(activity, options);
      scanner.startScan()
        .addOnSuccessListener(barcode -> {
          JSObject out = new JSObject();
          String value = barcode != null ? barcode.getRawValue() : null;
          out.put("text", value != null ? value : "");
          out.put("cancelled", false);
          call.resolve(out);
        })
        .addOnCanceledListener(() -> {
          JSObject out = new JSObject();
          out.put("text", "");
          out.put("cancelled", true);
          call.resolve(out);
        })
        .addOnFailureListener(e -> {
          String msg = e.getMessage() != null ? e.getMessage() : "scan failed";
          call.reject(msg);
        });
    } catch (Exception e) {
      call.reject(e.getMessage() != null ? e.getMessage() : "scanner unavailable");
    }
  }
}
