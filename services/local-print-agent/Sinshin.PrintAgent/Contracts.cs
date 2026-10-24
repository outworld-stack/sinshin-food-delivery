using System.Text.Json;
using System.Text.Json.Serialization;

namespace Sinshin.PrintAgent;

public static class AgentJson
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        MaxDepth = 16
    };
}

public sealed record PrinterInfo(string Name, bool IsDefault);

public sealed record PrintClaim(
    string Id,
    string ClaimToken,
    string PrinterName,
    int WidthPx,
    int HeightPx,
    string Rows,
    int Copies,
    bool Cut,
    string Mode,
    string JobName);

public sealed record JobReport(string ClaimToken, string Status, string? Error);

public sealed record JournalEntry(
    string JobId,
    string ClaimToken,
    string PayloadHash,
    string Status,
    string? Error,
    DateTimeOffset UpdatedAt,
    bool Reported);

public interface IPrinterBackend
{
    IReadOnlyList<PrinterInfo> GetPrinters();
    void Print(PrintClaim job, byte[] bitmap);
}

public interface IAgentApi
{
    Task HeartbeatAsync(IReadOnlyList<PrinterInfo> printers, CancellationToken cancellation);
    Task<PrintClaim?> ClaimAsync(CancellationToken cancellation);
    Task ReportAsync(JournalEntry entry, CancellationToken cancellation);
}

/// <summary>Only a failure proven to occur before spool submission is retry-safe.</summary>
public sealed class PrinterFailureException(string message, bool mayHavePrinted) : Exception(message)
{
    public bool MayHavePrinted { get; } = mayHavePrinted;
}

public sealed class AgentAuthenticationException() : Exception("The print-agent token was rejected. Pair this station again.");
