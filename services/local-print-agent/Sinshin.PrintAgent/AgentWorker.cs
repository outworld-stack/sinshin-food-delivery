namespace Sinshin.PrintAgent;

public sealed class AgentWorker(
    IAgentApi api,
    IPrinterBackend printer,
    JobJournal journal,
    Action<string> log)
{
    private readonly JobExecutor executor = new(journal, printer);

    public async Task RunAsync(CancellationToken cancellation)
    {
        using var stop = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        Task heartbeat = HeartbeatLoop(stop.Token);
        Task work = WorkLoop(stop.Token);
        await Task.WhenAny(heartbeat, work);
        stop.Cancel();
        await Task.WhenAll(heartbeat, work);
    }

    // Kept independent of spool submission: an offline Windows queue can take
    // longer than a heartbeat interval while the service is otherwise healthy.
    private async Task HeartbeatLoop(CancellationToken cancellation)
    {
        int failures = 0;
        while (!cancellation.IsCancellationRequested)
        {
            try
            {
                await api.HeartbeatAsync(printer.GetPrinters(), cancellation);
                if (failures > 0) log("Server connection restored.");
                failures = 0;
                await Task.Delay(TimeSpan.FromSeconds(15), cancellation);
            }
            catch (AgentAuthenticationException) { throw; }
            catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { throw; }
            catch (Exception error)
            {
                failures++;
                if (failures == 1) log($"Heartbeat unavailable ({SafeError(error)}). Retrying automatically.");
                await Task.Delay(RetryDelay(failures), cancellation);
            }
        }
    }

    private async Task WorkLoop(CancellationToken cancellation)
    {
        int failures = 0;
        while (!cancellation.IsCancellationRequested)
        {
            try
            {
                await RunCycleAsync(cancellation);
                failures = 0;
                await Task.Delay(TimeSpan.FromSeconds(2), cancellation);
            }
            catch (AgentAuthenticationException) { throw; }
            catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { throw; }
            catch (Exception error)
            {
                failures++;
                if (failures == 1) log($"Queue unavailable ({SafeError(error)}). No job will be automatically reprinted.");
                await Task.Delay(RetryDelay(failures), cancellation);
            }
        }
    }

    public async Task RunCycleAsync(CancellationToken cancellation)
    {
        // Resolve prior acknowledgements before claiming another invoice. A lost
        // result response must not lead to a second call to Windows printing.
        foreach (JournalEntry pending in journal.Unreported())
        {
            await api.ReportAsync(pending, cancellation);
            journal.MarkReported(pending);
        }
        PrintClaim? job = await api.ClaimAsync(cancellation);
        if (job is null) return;
        JournalEntry result = await executor.ExecuteAsync(job);
        log($"Job {result.JobId}: {result.Status}.");
        await api.ReportAsync(result, cancellation);
        journal.MarkReported(result);
    }

    private static TimeSpan RetryDelay(int failures) => TimeSpan.FromSeconds(Math.Min(30, 2 * Math.Pow(2, Math.Min(failures - 1, 4))));

    private static string SafeError(Exception error) => error is HttpRequestException http && http.StatusCode is not null
        ? $"HTTP {(int)http.StatusCode}"
        : error is InvalidDataException ? "invalid response or journal" : "network or Windows printer service error";
}
