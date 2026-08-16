package vc.goon.android;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(FabricKeyStorePlugin.class);
    registerPlugin(FabricQrScannerPlugin.class);
    super.onCreate(savedInstanceState);
  }
}
