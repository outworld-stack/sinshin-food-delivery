using System.Net;
using System.Text;
using System.Text.Json;
using Sinshin.PrintAgent;

int assertions = 0;
void Assert(bool condition, string message)
{
    assertions++;
    if (!condition) throw new Exception(message);
}
void Throws<T>(Action action, string message) where T : Exception
{
    bool thrown = false;
    try { action(); } catch (T) { thrown = true; }
    Assert(thrown, message);
}
async Task ThrowsAsync<T>(Func<Task> action, string message) where T : Exception
{
    bool thrown = false;
    try { await action(); } catch (T) { thrown = true; }
    Assert(thrown, message);
}

PrintClaim Job(int width = 576, int height = 5) => new(Guid.NewGuid().ToString("D"), new string('c', 43), "Receipt queue", width, height,
    Convert.ToBase64String(new byte[(width + 7) / 8 * height]), 1, true, "driver", "Sinshin invoice");
string root = Path.Combine(Directory.GetCurrentDirectory(), ".test-data", Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);
string Data(string name) { string path = Path.Combine(root, name); Directory.CreateDirectory(path); return path; }

PrintClaim sample = Job();
Assert(JobValidator.Validate(sample).Length == 360, "Valid receipt decodes its exact byte length.");
foreach (PrintClaim invalid in new[]
{
    sample with { Id = "../escape" }, sample with { WidthPx = 500 }, sample with { HeightPx = 4001 },
    sample with { HeightPx = 0 }, sample with { Copies = 2 }, sample with { Mode = "raw-command" },
    sample with { PrinterName = "printer\ncommand" }, sample with { Rows = "AAAA" }, sample with { JobName = "title\0" },
    sample with { ClaimToken = "" }
}) Throws<InvalidDataException>(() => JobValidator.Validate(invalid), "Invalid job must be rejected before printing.");
PrintClaim narrow = Job(420, 1);
byte[] narrowRows = JobValidator.Validate(narrow);
narrowRows[^1] = 1;
Throws<InvalidDataException>(() => JobValidator.Validate(narrow with { Rows = Convert.ToBase64String(narrowRows) }), "Padding bits cannot create stray ink.");
Assert(JobValidator.PayloadHash(sample) != JobValidator.PayloadHash(sample with { Cut = false }), "Print settings belong to the idempotency hash.");

byte[] blackRows = [0x80, .. new byte[47]];
byte[] encoded = EscPosEncoder.Encode(384, 1, blackRows, true);
Assert(encoded.AsSpan(0, 10).SequenceEqual(new byte[] { 0x1b, 0x40, 0x1d, 0x76, 0x30, 0, 48, 0, 1, 0 }), "ESC/POS width uses bytes, height uses dots.");
Assert(encoded[10] == 0x80, "MSB-first bitmap pixels are preserved.");
Assert(encoded.AsSpan(encoded.Length - 10).SequenceEqual(new byte[] { 0x0a, 0x1b, 0x64, 2, 0x1d, 0x56, 0x42, 0, 0x1b, 0x40 }), "Cut/feed framing matches the existing API encoder.");
byte[] noCut = EscPosEncoder.Encode(384, 1, blackRows, false);
Assert(noCut.Length == encoded.Length - 4, "Disabled cutter emits no cutter command.");
byte[] fragmented = EscPosEncoder.Encode(576, 961, new byte[72 * 961], false);
int secondFrame = 2 + 8 + 72 * 960;
Assert(fragmented.AsSpan(secondFrame, 8).SequenceEqual(new byte[] { 0x1d, 0x76, 0x30, 0, 72, 0, 1, 0 }), "Continuous receipt fragments have no inserted line feed.");
Throws<InvalidDataException>(() => EscPosEncoder.Encode(384, 3, blackRows, true), "Encoder rejects truncated raster data.");
Assert(ReceiptDimensions.ContentWidthMm(576) == 72 && ReceiptDimensions.StockWidthMm(576) == 80, "80mm paper has 72mm actual ink width.");
Assert(ReceiptDimensions.ContentWidthMm(384) == 48 && ReceiptDimensions.StockWidthMm(420) == 58, "58mm printer widths remain physical dimensions.");
Assert(ReceiptDimensions.ContentHeightMm(800) == 100, "Receipt height follows the original 8-dot/mm raster.");
using (var bitmap = WindowsPrinterBackend.CreateBitmap(384, 1, blackRows))
{
    Assert(bitmap.GetPixel(0, 0).R == 0 && bitmap.GetPixel(1, 0).R == 255, "Driver bitmap preserves black/white bit order.");
    Assert(Math.Abs(bitmap.HorizontalResolution - 203.2) < 0.01, "Driver bitmap reports the native receipt DPI.");
}

var printer = new FakePrinter();
var journal = new JobJournal(Data("normal"));
var executor = new JobExecutor(journal, printer);
JournalEntry first = await executor.ExecuteAsync(sample);
Assert(first.Status == "spooled" && printer.Count == 1, "Successful submission is recorded as spooler acceptance.");
Assert(!first.Reported, "Submission is durable before network acknowledgement.");
await executor.ExecuteAsync(sample);
Assert(printer.Count == 1, "Repeated job IDs never print twice.");
await ThrowsAsync<InvalidDataException>(() => executor.ExecuteAsync(sample with { Cut = false }), "Conflicting immutable job content is rejected.");
await ThrowsAsync<InvalidDataException>(() => executor.ExecuteAsync(sample with { ClaimToken = new string('d', 43) }), "Conflicting claim tokens cannot reuse the job.");
var concurrentJob = Job();
await Task.WhenAll(executor.ExecuteAsync(concurrentJob), executor.ExecuteAsync(concurrentJob));
Assert(printer.Count == 2, "Concurrent duplicates share one serialized submission.");

var knownFailure = new FakePrinter { Failure = new PrinterFailureException("queue removed", false) };
var failed = await new JobExecutor(new JobJournal(Data("failed")), knownFailure).ExecuteAsync(Job());
Assert(failed.Status == "failed", "Failure before submission is distinguished from uncertainty.");
var partialFailure = new FakePrinter { Failure = new PrinterFailureException("write interrupted", true) };
var uncertain = await new JobExecutor(new JobJournal(Data("partial")), partialFailure).ExecuteAsync(Job());
Assert(uncertain.Status == "uncertain", "Partial spool submission must never be automatically retried.");

string recoveryPath = Data("recovery");
var recoveryJob = Job();
new JobJournal(recoveryPath).Save(new JournalEntry(recoveryJob.Id, recoveryJob.ClaimToken, JobValidator.PayloadHash(recoveryJob), "processing", null, DateTimeOffset.UtcNow, false));
var recoveredJournal = new JobJournal(recoveryPath);
Assert(recoveredJournal.Find(recoveryJob.Id)?.Status == "uncertain", "Restart recovers interrupted submission as uncertain.");
var recoveredPrinter = new FakePrinter();
await new JobExecutor(recoveredJournal, recoveredPrinter).ExecuteAsync(recoveryJob);
Assert(recoveredPrinter.Count == 0, "Restart cannot duplicate a job that might have printed.");
string corruptPath = Data("corrupt");
Directory.CreateDirectory(Path.Combine(corruptPath, "jobs"));
File.WriteAllText(Path.Combine(corruptPath, "jobs", Guid.NewGuid() + ".json"), "not JSON");
Throws<JsonException>(() => new JobJournal(corruptPath), "Corrupt journals fail closed instead of losing deduplication.");
Assert(!Directory.EnumerateFiles(recoveryPath, "*.tmp", SearchOption.AllDirectories).Any(), "Atomic journal writes leave no pending temp files.");

var reportApi = new FakeApi { NextJob = Job(), FailReports = 1 };
var reportPrinter = new FakePrinter();
var reportJournal = new JobJournal(Data("report-retry"));
var worker = new AgentWorker(reportApi, reportPrinter, reportJournal, _ => { });
await ThrowsAsync<HttpRequestException>(() => worker.RunCycleAsync(CancellationToken.None), "Lost result ACK propagates for retry.");
Assert(reportPrinter.Count == 1 && reportJournal.Unreported().Count == 1, "Lost ACK leaves a durable result, not a reprint request.");
await worker.RunCycleAsync(CancellationToken.None);
Assert(reportPrinter.Count == 1 && reportJournal.Unreported().Count == 0 && reportApi.Reports == 2, "Retry sends only the result acknowledgement.");
var restartApi = new FakeApi();
await new AgentWorker(restartApi, new FakePrinter(), recoveredJournal, _ => { }).RunCycleAsync(CancellationToken.None);
Assert(restartApi.LastReport?.Status == "uncertain", "Restart reports uncertainty back to mobile/admin clients.");

Assert(AgentConfiguration.ValidateApiBaseUrl("https://restaurant.example/api").AbsoluteUri == "https://restaurant.example/api/", "API base URL appends routes consistently.");
Assert(AgentConfiguration.ValidateApiBaseUrl("http://localhost:3000/api").IsLoopback, "Local development HTTP is allowed.");
foreach (string badUrl in new[] { "http://restaurant.example/api", "https://user:secret@example.org/api", "https://example.org/api?token=x", "https://example.org/" })
    Throws<InvalidDataException>(() => AgentConfiguration.ValidateApiBaseUrl(badUrl), "Unsafe or malformed server URL rejected.");
string secret = new('s', 48);
string protectedSecret = TokenProtection.Protect(secret);
Assert(protectedSecret != secret && TokenProtection.Unprotect(protectedSecret) == secret, "Pairing token is encrypted for the current Windows account.");
var configuration = new AgentConfiguration("https://restaurant.example/api", protectedSecret);
new JobJournal(configuration.StationDirectory(root, secret)).Save(first);
Assert(new JobJournal(configuration.StationDirectory(root, secret)).Unreported().Single().JobId == sample.Id, "Re-entering the same pairing preserves its pending acknowledgement.");
Assert(new JobJournal(configuration.StationDirectory(root, new string('t', 48))).Unreported().Count == 0 &&
    new JobJournal(configuration.StationDirectory(root, secret)).Find(sample.Id) is not null,
    "A new station has no unauthorized ACK backlog while the old receipt remains preserved.");

var handler = new CaptureHandler();
using (var api = new HttpAgentApi(new Uri("https://restaurant.example/api/"), secret, handler))
{
    handler.ResponseBody = JsonSerializer.Serialize(new { agentId = Guid.NewGuid().ToString("D") });
    await api.HeartbeatAsync([new PrinterInfo("Receipt queue", true)], CancellationToken.None);
    Assert(handler.LastUri == "https://restaurant.example/api/print-agent/heartbeat", "Heartbeat uses the server API prefix.");
    Assert(handler.LastAuth == "Bearer " + secret && !handler.LastUri.Contains(secret), "Token is in Authorization, never the URL.");
    Assert(handler.LastBody.Contains("Receipt queue") && !handler.LastBody.Contains(secret), "Heartbeat sends queue metadata without credentials.");
    handler.ResponseBody = "{\"job\":null}";
    Assert(await api.ClaimAsync(CancellationToken.None) is null, "Idle server queue is handled explicitly.");
    Assert(handler.LastUri.EndsWith("/print-agent/claim"), "Agent claims through the outbound endpoint.");
    handler.ResponseBody = JsonSerializer.Serialize(new { job = new { id = sample.Id, status = "spooled" } });
    await api.ReportAsync(first, CancellationToken.None);
    Assert(handler.LastUri.EndsWith($"/print-agent/jobs/{sample.Id}/result") && handler.LastBody.Contains("spooled"), "Result reports match the protocol.");
    Assert(!handler.LastBody.Contains("\"error\""), "Successful results omit error rather than sending null to the server schema.");
    handler.ResponseBody = "{\"job\":null}";
    await ThrowsAsync<InvalidDataException>(() => api.ReportAsync(first, CancellationToken.None), "HTTP 200 alone cannot falsely acknowledge a result.");
    handler.ResponseBody = "<html>Sign in</html>";
    await ThrowsAsync<JsonException>(() => api.ReportAsync(first, CancellationToken.None), "A proxy's HTML response cannot discard the result journal.");
    handler.ResponseStatus = HttpStatusCode.Unauthorized;
    await ThrowsAsync<AgentAuthenticationException>(() => api.ClaimAsync(CancellationToken.None), "Revoked pairing token stops authorization.");
    handler.ResponseStatus = HttpStatusCode.Conflict;
    await ThrowsAsync<HttpRequestException>(() => api.ReportAsync(first, CancellationToken.None), "Conflicting results are not treated as acknowledged.");
    handler.ResponseStatus = HttpStatusCode.Redirect;
    await ThrowsAsync<HttpRequestException>(() => api.ClaimAsync(CancellationToken.None), "Redirects cannot silently move bearer credentials.");
}

Console.WriteLine($"Print agent verification passed: {assertions} assertions. No Windows printer received a job.");
Console.WriteLine("Test journal fixtures remain under .test-data for inspection (ignored by Git and release packaging).");

sealed class FakePrinter : IPrinterBackend
{
    public int Count;
    public Exception? Failure;
    public IReadOnlyList<PrinterInfo> GetPrinters() => [new("Receipt queue", true)];
    public void Print(PrintClaim job, byte[] bitmap)
    {
        Interlocked.Increment(ref Count);
        if (Failure is not null) throw Failure;
    }
}

sealed class FakeApi : IAgentApi
{
    public PrintClaim? NextJob;
    public int FailReports;
    public int Reports;
    public JournalEntry? LastReport;
    public Task HeartbeatAsync(IReadOnlyList<PrinterInfo> printers, CancellationToken cancellation) => Task.CompletedTask;
    public Task<PrintClaim?> ClaimAsync(CancellationToken cancellation)
    {
        var result = NextJob;
        NextJob = null;
        return Task.FromResult(result);
    }
    public Task ReportAsync(JournalEntry entry, CancellationToken cancellation)
    {
        Reports++;
        LastReport = entry;
        if (FailReports-- > 0) throw new HttpRequestException("ACK lost");
        return Task.CompletedTask;
    }
}

sealed class CaptureHandler : HttpMessageHandler
{
    public string LastUri = "";
    public string LastAuth = "";
    public string LastBody = "";
    public string ResponseBody = "{}";
    public HttpStatusCode ResponseStatus = HttpStatusCode.OK;
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        LastUri = request.RequestUri!.AbsoluteUri;
        LastAuth = request.Headers.Authorization?.ToString() ?? "";
        LastBody = request.Content is null ? "" : await request.Content.ReadAsStringAsync(cancellationToken);
        return new HttpResponseMessage(ResponseStatus) { Content = new StringContent(ResponseBody, Encoding.UTF8, "application/json") };
    }
}
