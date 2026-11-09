// 先生PC用の中継アプリ。児童の Chromebook(Web Bluetooth)と、先生PCの Node サーバー(server/relay)をつなぐ。
//
//   Chromebook ──(Bluetooth LE / GATT)──▶ このアプリ ──(127.0.0.1 の TCP、行区切りの JSON)──▶ Node サーバー
//
// このアプリがすることは「バイトを運ぶこと」だけ:
//   ・GATT のサービス(下の ServiceUuid)を公開する。RX(書きこみ)・TX(通知)の2つの特性を持つ。
//   ・端末が RX に書いたバイトを、{"t":"rx","s":"<接続の名前>","b":"<base64>"} で Node へ送る。
//   ・Node が返してきた {"t":"tx",…} を、その端末へ TX の通知で送る。
//   ・端末がつながった/切れたことを、{"t":"open",…,"mtu":N} / {"t":"close",…} で知らせる。
// メッセージの意味・chunk の組み立て・教室のデータは、全部 Node 側(public/js/relay/protocol.js ほか)。
//
// 使い方:  TeacherRelay.exe [--host 127.0.0.1] [--port 8788] [--name KyozaiRelay]
// UUID は、public/js/relay/protocol.js と同じ値にすること。
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Windows.Devices.Bluetooth;
using Windows.Devices.Bluetooth.GenericAttributeProfile;
using Windows.Storage.Streams;

Console.OutputEncoding = Encoding.UTF8;


string Arg(string key, string fallback)
{
    var i = Array.IndexOf(args, key);
    return i >= 0 && i + 1 < args.Length ? args[i + 1] : fallback;
}
var host = Arg("--host", "127.0.0.1");
var port = int.Parse(Arg("--port", "8788"));
var appName = Arg("--name", "KyozaiRelay");

using var quit = new CancellationTokenSource();
Console.CancelKeyPress += (_, e) => { e.Cancel = true; quit.Cancel(); };

var relay = new Relay(host, port, appName);
var ok = await relay.StartBluetoothAsync();
if (!ok) return 1;
Console.WriteLine($"先生のパソコンの Bluetooth で、児童の端末からの接続を待っています。(Ctrl+C で終了)");
Console.WriteLine($"Node サーバーとの口:{host}:{port}(つながるまで、くり返しためします)");
await relay.RunAsync(quit.Token);
relay.Stop();
return 0;

/// <summary>GATT サーバー(Bluetooth の待ち受け役)と、Node サーバーへの TCP の橋。</summary>
sealed class Relay
{
    // UUID は、public/js/relay/protocol.js と同じ値にすること
    const string ServiceUuid = "6c2f0001-8a4e-4b1d-9d3a-7f5e2c1b0a90";
    const string RxUuid = "6c2f0002-8a4e-4b1d-9d3a-7f5e2c1b0a90"; // 端末 → 先生PC(Write / WriteWithoutResponse)
    const string TxUuid = "6c2f0003-8a4e-4b1d-9d3a-7f5e2c1b0a90"; // 先生PC → 端末(Notify)

    readonly string host, appName;
    readonly int port;
    GattServiceProvider? provider;
    GattLocalCharacteristic? tx;
    readonly object gate = new();
    // 接続の名前 → いま通知を受けている端末
    readonly Dictionary<string, GattSubscribedClient> clients = new();
    // 接続の名前 → Node に「開いた」と知らせてある(MTU つき)
    readonly HashSet<string> opened = new();
    StreamWriter? bridge;

    public Relay(string host, int port, string appName) { this.host = host; this.port = port; this.appName = appName; }

    // 端末ごとの、Node に見せる名前(Bluetooth のアドレスそのものは、Node に渡さない)。英数字 16 文字
    static string SessionName(GattSession s) =>
        Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes(s.DeviceId.Id)))[..16].ToLowerInvariant();

    static byte[] Bytes(IBuffer b)
    {
        using var r = DataReader.FromBuffer(b);
        var bytes = new byte[r.UnconsumedBufferLength];
        r.ReadBytes(bytes);
        return bytes;
    }

    static IBuffer Buffer(byte[] bytes)
    {
        using var w = new DataWriter();
        w.WriteBytes(bytes);
        return w.DetachBuffer();
    }

    public async Task<bool> StartBluetoothAsync()
    {
        var created = await GattServiceProvider.CreateAsync(Guid.Parse(ServiceUuid));
        if (created.Error != BluetoothError.Success)
        {
            Console.Error.WriteLine($"Bluetooth のサービスを作れませんでした:{created.Error}");
            Console.Error.WriteLine(created.Error == BluetoothError.RadioNotAvailable
                ? "→ このパソコンの Bluetooth が、オフか、ありません。設定で Bluetooth をオンにしてください。"
                : "→ このパソコンの Bluetooth が、「待ち受け役(ペリフェラル)」に対応していないかもしれません。別のパソコン、または USB の Bluetooth 4.0 以降のアダプターを試してください。");
            return false;
        }
        provider = created.ServiceProvider;

        var rxResult = await provider.Service.CreateCharacteristicAsync(Guid.Parse(RxUuid), new GattLocalCharacteristicParameters
        {
            CharacteristicProperties = GattCharacteristicProperties.Write | GattCharacteristicProperties.WriteWithoutResponse,
            WriteProtectionLevel = GattProtectionLevel.Plain,
            UserDescription = "rx",
        });
        var txResult = await provider.Service.CreateCharacteristicAsync(Guid.Parse(TxUuid), new GattLocalCharacteristicParameters
        {
            CharacteristicProperties = GattCharacteristicProperties.Notify,
            ReadProtectionLevel = GattProtectionLevel.Plain,
            UserDescription = "tx",
        });
        if (rxResult.Error != BluetoothError.Success || txResult.Error != BluetoothError.Success)
        {
            Console.Error.WriteLine($"Bluetooth の特性を作れませんでした:rx={rxResult.Error} tx={txResult.Error}");
            return false;
        }
        tx = txResult.Characteristic;
        rxResult.Characteristic.WriteRequested += OnWriteRequested;
        tx.SubscribedClientsChanged += (_, _) => SyncSubscribers();

        provider.AdvertisementStatusChanged += (_, e) => Console.WriteLine($"Bluetooth の広告:{e.Status}");
        provider.StartAdvertising(new GattServiceProviderAdvertisingParameters { IsConnectable = true, IsDiscoverable = true });
        return true;
    }

    public void Stop()
    {
        try { provider?.StopAdvertising(); } catch { /* 終了のときの失敗は、気にしない */ }
    }

    // ---- 端末 → Node ----
    async void OnWriteRequested(GattLocalCharacteristic sender, GattWriteRequestedEventArgs args)
    {
        var deferral = args.GetDeferral();
        try
        {
            var request = await args.GetRequestAsync();
            var name = SessionName(args.Session);
            // 通知を受ける前に書いてきた端末:通知の大きさは、わかっている範囲の値にする(ATT の MTU − 3)
            EnsureOpen(name, Math.Max(20, args.Session.MaxPduSize - 3));
            Send(new { t = "rx", s = name, b = Convert.ToBase64String(Bytes(request.Value)) });
            if (request.Option == GattWriteOption.WriteWithResponse) request.Respond();
        }
        catch (Exception e) { Console.Error.WriteLine($"書きこみの処理に失敗:{e.Message}"); }
        finally { deferral.Complete(); }
    }

    // 通知を受けはじめた/やめた端末を、Node に知らせる
    void SyncSubscribers()
    {
        if (tx is null) return;
        var now = tx.SubscribedClients.ToDictionary(c => SessionName(c.Session), c => c);
        List<string> gone;
        lock (gate)
        {
            gone = clients.Keys.Where(k => !now.ContainsKey(k)).ToList();
            clients.Clear();
            foreach (var (k, c) in now) clients[k] = c;
        }
        foreach (var name in gone)
        {
            lock (gate) opened.Remove(name);
            Send(new { t = "close", s = name });
            Console.WriteLine($"児童の端末が切れました({name[..6]}…)");
        }
        foreach (var (name, c) in now) EnsureOpen(name, (int)c.MaxNotificationSize);
    }

    void EnsureOpen(string name, int mtu)
    {
        lock (gate) { if (!opened.Add(name)) return; }
        Send(new { t = "open", s = name, mtu });
        Console.WriteLine($"児童の端末がつながりました({name[..6]}…、1回の通知 {mtu} バイト)");
    }

    // ---- Node への橋(TCP)----
    void Send(object message)
    {
        var w = bridge;
        if (w is null) return; // Node につながっていない間のものは捨てる(端末側が、つなぎなおす)
        var line = JsonSerializer.Serialize(message);
        lock (w) { try { w.Write(line); w.Write('\n'); w.Flush(); } catch { /* 切れたら、読む側が気づいて、つなぎなおす */ } }
    }

    /// <summary>Node サーバーにつなぎ、切れたらつなぎなおす。Node から届いた通知を、端末へ送る。</summary>
    public async Task RunAsync(CancellationToken stop)
    {
        while (!stop.IsCancellationRequested)
        {
            try
            {
                using var tcp = new TcpClient();
                await tcp.ConnectAsync(host, port, stop);
                var stream = tcp.GetStream();
                var writer = new StreamWriter(stream, new UTF8Encoding(false)) { AutoFlush = false };
                bridge = writer;
                Console.WriteLine("Node サーバーにつながりました");
                Send(new { t = "hello", app = "TeacherRelay", name = appName });
                // つながっていた端末を、あらためて知らせる(Node を再起動したとき)
                lock (gate) opened.Clear();
                SyncSubscribers();

                using var reader = new StreamReader(stream, Encoding.UTF8);
                string? line;
                while (!stop.IsCancellationRequested && (line = await reader.ReadLineAsync(stop)) is not null)
                {
                    try { await HandleFromNodeAsync(line); }
                    catch (Exception e) { Console.Error.WriteLine($"Node からのメッセージの処理に失敗:{e.Message}"); }
                }
            }
            catch (OperationCanceledException) { break; }
            catch (Exception e) { Console.Error.WriteLine($"Node サーバーにつながりません({e.Message})。2秒後にもう一度ためします。"); }
            finally { bridge = null; }
            try { await Task.Delay(2000, stop); } catch (OperationCanceledException) { break; }
        }
    }

    // 通知は、1つずつ順番に送る(chunk の順番が入れかわらないように)
    async Task HandleFromNodeAsync(string line)
    {
        using var doc = JsonDocument.Parse(line);
        var root = doc.RootElement;
        if (root.GetProperty("t").GetString() != "tx" || tx is null) return;
        var name = root.GetProperty("s").GetString() ?? "";
        GattSubscribedClient? client;
        lock (gate) clients.TryGetValue(name, out client);
        if (client is null) return; // もう切れた端末
        var bytes = Convert.FromBase64String(root.GetProperty("b").GetString() ?? "");
        var result = await tx.NotifyValueAsync(Buffer(bytes), client);
        if (result.Status != GattCommunicationStatus.Success)
            Console.Error.WriteLine($"通知を送れませんでした:{result.Status}");
    }
}
