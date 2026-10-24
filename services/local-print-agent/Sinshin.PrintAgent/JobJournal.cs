using System.Text.Json;

namespace Sinshin.PrintAgent;

/// <summary>Do not delete this journal to repair connectivity; it prevents duplicate paper.</summary>
public sealed class JobJournal
{
    private readonly string directory;
    private readonly Dictionary<string, JournalEntry> entries = new(StringComparer.OrdinalIgnoreCase);

    public JobJournal(string dataDirectory)
    {
        directory = Path.Combine(dataDirectory, "jobs");
        Directory.CreateDirectory(directory);
        foreach (string path in Directory.EnumerateFiles(directory, "*.json"))
        {
            // Fail closed if a receipt is corrupt: silently ignoring it could duplicate a print.
            JournalEntry entry = JsonSerializer.Deserialize<JournalEntry>(File.ReadAllText(path), AgentJson.Options)
                ?? throw new InvalidDataException("A print journal entry is unreadable. Restore the journal before restarting.");
            if (!Guid.TryParseExact(entry.JobId, "D", out _) ||
                !string.Equals(Path.GetFileNameWithoutExtension(path), entry.JobId, StringComparison.OrdinalIgnoreCase) ||
                entry.Status is not ("processing" or "spooled" or "failed" or "uncertain"))
                throw new InvalidDataException("A print journal entry is invalid. Review the journal before restarting.");
            entries.Add(entry.JobId, entry);
        }
        foreach (JournalEntry entry in entries.Values.ToArray())
        {
            if (entry.Status == "processing")
                Save(entry with { Status = "uncertain", Error = "Agent stopped during submission; check the printer before reprinting.", Reported = false, UpdatedAt = DateTimeOffset.UtcNow });
        }
    }

    public JournalEntry? Find(string jobId) => entries.GetValueOrDefault(jobId);

    public IReadOnlyList<JournalEntry> Unreported() => entries.Values
        .Where(entry => !entry.Reported && entry.Status != "processing")
        .OrderBy(entry => entry.UpdatedAt).ToArray();

    public void Save(JournalEntry entry)
    {
        if (!Guid.TryParseExact(entry.JobId, "D", out _)) throw new InvalidDataException("Invalid journal ID.");
        AtomicFile.WriteJson(Path.Combine(directory, entry.JobId + ".json"), entry);
        entries[entry.JobId] = entry;
    }

    public void MarkReported(JournalEntry entry) => Save(entry with { Reported = true, UpdatedAt = DateTimeOffset.UtcNow });
}
