namespace Sinshin.PrintAgent;

public sealed class JobExecutor(JobJournal journal, IPrinterBackend printer)
{
    private readonly SemaphoreSlim gate = new(1, 1);

    public async Task<JournalEntry> ExecuteAsync(PrintClaim job)
    {
        // One worker and one spool submission at a time, even if a caller retries concurrently.
        await gate.WaitAsync();
        try
        {
            byte[] bitmap = JobValidator.Validate(job);
            string payloadHash = JobValidator.PayloadHash(job);
            JournalEntry? existing = journal.Find(job.Id);
            if (existing is not null)
            {
                if (existing.PayloadHash != payloadHash || existing.ClaimToken != job.ClaimToken)
                    throw new InvalidDataException("The server reused a print job ID with different content or claim token.");
                return existing;
            }
            var entry = new JournalEntry(job.Id, job.ClaimToken, payloadHash, "processing", null, DateTimeOffset.UtcNow, false);
            journal.Save(entry); // Must be durable BEFORE Windows receives any bytes.
            try
            {
                // Cancellation does not abort a submission: paper may already have left the printer.
                await Task.Run(() => printer.Print(job, bitmap));
                entry = entry with { Status = "spooled", UpdatedAt = DateTimeOffset.UtcNow };
            }
            catch (PrinterFailureException error)
            {
                entry = entry with { Status = error.MayHavePrinted ? "uncertain" : "failed", Error = error.Message, UpdatedAt = DateTimeOffset.UtcNow };
            }
            catch (Exception)
            {
                entry = entry with { Status = "uncertain", Error = "Windows submission did not complete normally; inspect the printer before reprinting.", UpdatedAt = DateTimeOffset.UtcNow };
            }
            journal.Save(entry); // Report only after local terminal state is durable.
            return entry;
        }
        finally { gate.Release(); }
    }
}
