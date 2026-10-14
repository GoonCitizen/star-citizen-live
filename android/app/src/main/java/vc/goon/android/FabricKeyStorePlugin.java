package vc.goon.android;

import android.app.Activity;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyInfo;
import android.security.keystore.KeyProperties;
import android.view.WindowManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Hardware-backed wrap of the password-sealed identity blob.
 * AES-256-GCM in Android Keystore (StrongBox when the device has it, else TEE).
 * Ciphertext lives in app-private files, not SharedPreferences / WebView storage.
 */
@CapacitorPlugin(name = "FabricKeyStore")
public class FabricKeyStorePlugin extends Plugin {
  private static final String ANDROID_KS = "AndroidKeyStore";
  private static final String KEY_ALIAS = "vc.goon.android.identity-wrap";
  private static final String FILE_NAME = "identity.wrapped";
  private static final String META_NAME = "identity.wrap.meta";
  private static final String TRANSFORMATION = "AES/GCM/NoPadding";
  private static final int GCM_IV_BYTES = 12;
  private static final int GCM_TAG_BITS = 128;
  private static final byte[] MAGIC = new byte[] { 'G', 'C', 'W', '1' };
  private boolean generatedStrongBox = false;

  @PluginMethod
  public void status(PluginCall call) {
    JSObject out = new JSObject();
    out.put("available", true);
    String backend = readMetaBackend();
    boolean hasFile = wrapFile().isFile();
    SecretKey key = loadKey(false);
    if (key != null) {
      String live = inspectBackend(key);
      if (live != null) backend = live;
    }
    out.put("strongBox", "strongbox".equals(backend));
    out.put("backend", backend != null ? backend : (hasFile ? "tee" : "none"));
    out.put("hasWrappedIdentity", hasFile);
    call.resolve(out);
  }

  @PluginMethod
  public void writeIdentity(PluginCall call) {
    String json = call.getString("json");
    if (json == null || json.length() == 0) {
      call.reject("json required");
      return;
    }
    try {
      SecretKey key = loadKey(true);
      if (key == null) {
        call.reject("Android Keystore AES key unavailable");
        return;
      }
      byte[] iv = new byte[GCM_IV_BYTES];
      new SecureRandom().nextBytes(iv);
      Cipher cipher = Cipher.getInstance(TRANSFORMATION);
      cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(GCM_TAG_BITS, iv));
      byte[] ct = cipher.doFinal(json.getBytes(StandardCharsets.UTF_8));
      byte[] packed = new byte[MAGIC.length + iv.length + ct.length];
      System.arraycopy(MAGIC, 0, packed, 0, MAGIC.length);
      System.arraycopy(iv, 0, packed, MAGIC.length, iv.length);
      System.arraycopy(ct, 0, packed, MAGIC.length + iv.length, ct.length);
      atomicWrite(wrapFile(), packed);
      String backend = inspectBackend(key);
      if (backend == null) backend = "tee";
      writeMeta(backend);
      JSObject out = new JSObject();
      out.put("ok", true);
      out.put("backend", backend);
      call.resolve(out);
    } catch (Exception e) {
      call.reject(e.getMessage() != null ? e.getMessage() : "wrap failed");
    }
  }

  @PluginMethod
  public void readIdentity(PluginCall call) {
    File file = wrapFile();
    JSObject out = new JSObject();
    if (!file.isFile()) {
      call.resolve(out);
      return;
    }
    try {
      byte[] packed = readAll(file);
      if (packed.length < MAGIC.length + GCM_IV_BYTES + 16) {
        call.reject("wrapped identity is truncated");
        return;
      }
      for (int i = 0; i < MAGIC.length; i++) {
        if (packed[i] != MAGIC[i]) {
          call.reject("wrapped identity magic mismatch");
          return;
        }
      }
      SecretKey key = loadKey(false);
      if (key == null) {
        call.reject("Android Keystore key missing — restore this identity from seed or backup");
        return;
      }
      byte[] iv = new byte[GCM_IV_BYTES];
      System.arraycopy(packed, MAGIC.length, iv, 0, GCM_IV_BYTES);
      int ctLen = packed.length - MAGIC.length - GCM_IV_BYTES;
      byte[] ct = new byte[ctLen];
      System.arraycopy(packed, MAGIC.length + GCM_IV_BYTES, ct, 0, ctLen);
      Cipher cipher = Cipher.getInstance(TRANSFORMATION);
      cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(GCM_TAG_BITS, iv));
      String json = new String(cipher.doFinal(ct), StandardCharsets.UTF_8);
      out.put("json", json);
      String backend = inspectBackend(key);
      out.put("backend", backend != null ? backend : "tee");
      call.resolve(out);
    } catch (Exception e) {
      call.reject(e.getMessage() != null ? e.getMessage() : "unwrap failed");
    }
  }

  @PluginMethod
  public void clearIdentity(PluginCall call) {
    try {
      File f = wrapFile();
      if (f.isFile() && !f.delete()) {
        call.reject("could not delete wrapped identity");
        return;
      }
      File meta = metaFile();
      if (meta.isFile()) meta.delete();
      KeyStore ks = KeyStore.getInstance(ANDROID_KS);
      ks.load(null);
      if (ks.containsAlias(KEY_ALIAS)) ks.deleteEntry(KEY_ALIAS);
      JSObject out = new JSObject();
      out.put("ok", true);
      call.resolve(out);
    } catch (Exception e) {
      call.reject(e.getMessage() != null ? e.getMessage() : "clear failed");
    }
  }

  @PluginMethod
  public void setSecureFlag(PluginCall call) {
    final boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
    final Activity activity = getActivity();
    if (activity == null) {
      call.resolve();
      return;
    }
    activity.runOnUiThread(new Runnable() {
      @Override
      public void run() {
        if (enabled) {
          activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        } else {
          activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
        }
      }
    });
    JSObject out = new JSObject();
    out.put("ok", true);
    out.put("enabled", enabled);
    call.resolve(out);
  }

  private File wrapFile() {
    return new File(getContext().getFilesDir(), FILE_NAME);
  }

  private File metaFile() {
    return new File(getContext().getFilesDir(), META_NAME);
  }

  private void writeMeta(String backend) {
    try {
      byte[] bytes = ("{\"backend\":\"" + backend + "\"}").getBytes(StandardCharsets.UTF_8);
      atomicWrite(metaFile(), bytes);
    } catch (Exception ignored) { /* status still inspects KeyInfo */ }
  }

  private String readMetaBackend() {
    File meta = metaFile();
    if (!meta.isFile()) return null;
    try {
      String s = new String(readAll(meta), StandardCharsets.UTF_8);
      int i = s.indexOf("strongbox");
      if (i >= 0) return "strongbox";
      if (s.indexOf("tee") >= 0) return "tee";
    } catch (Exception ignored) { }
    return null;
  }

  private SecretKey loadKey(boolean create) {
    try {
      KeyStore ks = KeyStore.getInstance(ANDROID_KS);
      ks.load(null);
      if (ks.containsAlias(KEY_ALIAS)) {
        KeyStore.SecretKeyEntry entry = (KeyStore.SecretKeyEntry) ks.getEntry(KEY_ALIAS, null);
        return entry != null ? entry.getSecretKey() : null;
      }
      if (!create) return null;
      return generateKey();
    } catch (Exception e) {
      return null;
    }
  }

  private SecretKey generateKey() throws Exception {
    KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KS);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      try {
        kg.init(spec(true));
        SecretKey key = kg.generateKey();
        generatedStrongBox = true;
        return key;
      } catch (Exception ignored) {
        /* StrongBox missing or full — TEE */
      }
    }
    generatedStrongBox = false;
    kg.init(spec(false));
    return kg.generateKey();
  }

  private KeyGenParameterSpec spec(boolean strongBox) {
    KeyGenParameterSpec.Builder b = new KeyGenParameterSpec.Builder(
      KEY_ALIAS,
      KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
    )
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setKeySize(256)
      .setRandomizedEncryptionRequired(true);
    if (strongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      b.setIsStrongBoxBacked(true);
    }
    return b.build();
  }

  private String inspectBackend(SecretKey key) {
    if (generatedStrongBox) return "strongbox";
    String meta = readMetaBackend();
    if (meta != null) return meta;
    try {
      SecretKeyFactory factory = SecretKeyFactory.getInstance(key.getAlgorithm(), ANDROID_KS);
      KeyInfo info = (KeyInfo) factory.getKeySpec(key, KeyInfo.class);
      if (info.isInsideSecureHardware()) return "tee";
    } catch (Exception ignored) { }
    return "tee";
  }

  private static byte[] readAll(File file) throws Exception {
    byte[] buf = new byte[(int) file.length()];
    FileInputStream in = new FileInputStream(file);
    try {
      int n = 0;
      while (n < buf.length) {
        int r = in.read(buf, n, buf.length - n);
        if (r < 0) break;
        n += r;
      }
      if (n != buf.length) {
        byte[] slim = new byte[n];
        System.arraycopy(buf, 0, slim, 0, n);
        return slim;
      }
      return buf;
    } finally {
      in.close();
    }
  }

  private static void atomicWrite(File dest, byte[] bytes) throws Exception {
    File tmp = new File(dest.getAbsolutePath() + ".tmp");
    FileOutputStream out = new FileOutputStream(tmp);
    try {
      out.write(bytes);
      out.flush();
      out.getFD().sync();
    } finally {
      out.close();
    }
    if (!tmp.renameTo(dest)) {
      if (dest.exists() && !dest.delete()) {
        tmp.delete();
        throw new Exception("could not replace " + dest.getName());
      }
      if (!tmp.renameTo(dest)) {
        tmp.delete();
        throw new Exception("could not move " + dest.getName());
      }
    }
  }
}
