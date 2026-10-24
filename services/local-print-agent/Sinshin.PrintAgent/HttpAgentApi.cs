using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Serialization;

namespace Sinshin.PrintAgent;

public sealed class HttpAgentApi : IAgentApi, IDisposable
{
    private readonly HttpClient client;

    public HttpAgentApi(Uri apiBaseUrl, string token, HttpMessageHandler? handler = null)
    {
        client = new HttpClient(handler ?? new HttpClientHandler { AllowAutoRedirect = false })
        {
            BaseAddress = new Uri(apiBaseUrl.AbsoluteUri.TrimEnd('/') + "/"),
            Timeout = TimeSpan.FromSeconds(15),
            MaxResponseContentBufferSize = 2_000_000
        };
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        client.DefaultRequestHeaders.UserAgent.ParseAdd("Sinshin.PrintAgent/1.0");
    }

    public async Task HeartbeatAsync(IReadOnlyList<PrinterInfo> printers, CancellationToken cancellation)
    {
        using HttpResponseMessage response = await client.PostAsJsonAsync("print-agent/heartbeat", new { printers }, AgentJson.Options, cancellation);
        EnsureSuccess(response);
        var heartbeat = await response.Content.ReadFromJsonAsync<HeartbeatEnvelope>(AgentJson.Options, cancellation);
        if (heartbeat is null || !Guid.TryParseExact(heartbeat.AgentId, "D", out _))
            throw new InvalidDataException("Server returned an invalid heartbeat response.");
    }

    public async Task<PrintClaim?> ClaimAsync(CancellationToken cancellation)
    {
        using HttpResponseMessage response = await client.PostAsJsonAsync("print-agent/claim", new { }, AgentJson.Options, cancellation);
        EnsureSuccess(response);
        var envelope = await response.Content.ReadFromJsonAsync<ClaimEnvelope>(AgentJson.Options, cancellation)
            ?? throw new InvalidDataException("Server returned an invalid claim response.");
        return envelope.Job;
    }

    public async Task ReportAsync(JournalEntry entry, CancellationToken cancellation)
    {
        if (!Guid.TryParseExact(entry.JobId, "D", out _)) throw new InvalidDataException("Invalid result job ID.");
        using HttpResponseMessage response = await client.PostAsJsonAsync(
            $"print-agent/jobs/{entry.JobId}/result",
            new JobReport(entry.ClaimToken, entry.Status, entry.Error), AgentJson.Options, cancellation);
        EnsureSuccess(response);
        var receipt = await response.Content.ReadFromJsonAsync<ResultEnvelope>(AgentJson.Options, cancellation);
        if (receipt?.Job is null || !string.Equals(receipt.Job.Id, entry.JobId, StringComparison.OrdinalIgnoreCase) || receipt.Job.Status != entry.Status)
            throw new InvalidDataException("Server did not confirm the submitted job result.");
    }

    private static void EnsureSuccess(HttpResponseMessage response)
    {
        if (response.StatusCode == HttpStatusCode.Unauthorized) throw new AgentAuthenticationException();
        if (!response.IsSuccessStatusCode)
        {
            // Do not log remote response bodies: they may contain application data.
            throw new HttpRequestException($"Print server returned HTTP {(int)response.StatusCode}.", null, response.StatusCode);
        }
    }

    public void Dispose() => client.Dispose();

    private sealed record ClaimEnvelope([property: JsonRequired] PrintClaim? Job);
    private sealed record HeartbeatEnvelope([property: JsonRequired] string AgentId);
    private sealed record ResultEnvelope([property: JsonRequired] ResultJob Job);
    private sealed record ResultJob([property: JsonRequired] string Id, [property: JsonRequired] string Status);
}
