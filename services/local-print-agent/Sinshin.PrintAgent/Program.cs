namespace Sinshin.PrintAgent;

public static class Program
{
    [STAThread]
    public static async Task<int> Main(string[] args)
    {
        try
        {
            if (args.Contains("--help"))
            {
                Console.WriteLine("Sinshin Print Agent\n  --configure       Pair this Windows account with the admin panel\n  --list-printers   List installed Windows queues without printing\n  --data-dir PATH   Override the per-user data directory\n  --help           Show this help\nWithout an action, runs the outbound print worker. Press Ctrl+C to stop.");
                return 0;
            }
            if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("This print agent requires Windows 10/11 and installed Windows printer drivers.");
            string dataDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Sinshin", "PrintAgent");
            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "--data-dir" && i + 1 < args.Length) dataDirectory = Path.GetFullPath(args[++i]);
                else if (args[i] is not ("--configure" or "--list-printers")) throw new ArgumentException("Unknown or incomplete command-line option. Use --help.");
            }
            Directory.CreateDirectory(dataDirectory);
            var printer = new WindowsPrinterBackend();
            if (args.Contains("--list-printers"))
            {
                foreach (PrinterInfo queue in printer.GetPrinters()) Console.WriteLine($"{(queue.IsDefault ? "* " : "  ")}{queue.Name}");
                return 0;
            }
            // FileShare.None works across processes and users without a named mutex
            // namespace. Hold it for the whole run; two workers must not share a journal.
            using var stationLock = new FileStream(Path.Combine(dataDirectory, "agent.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
            if (args.Contains("--configure")) { AgentConfiguration.Configure(dataDirectory); return 0; }
            AgentConfiguration configuration = AgentConfiguration.Load(dataDirectory);
            string token = TokenProtection.Unprotect(configuration.ProtectedToken);
            using var api = new HttpAgentApi(AgentConfiguration.ValidateApiBaseUrl(configuration.ApiBaseUrl), token);
            var journal = new JobJournal(configuration.StationDirectory(dataDirectory, token));
            using var cancellation = new CancellationTokenSource();
            Console.CancelKeyPress += (_, eventArgs) => { eventArgs.Cancel = true; cancellation.Cancel(); };
            Console.WriteLine("Sinshin Print Agent is running. Connection: outbound HTTPS; no inbound listener.");
            Console.WriteLine("Spooler acceptance does not confirm physical paper output. Keep the POS Windows account signed in.");
            try { await new AgentWorker(api, printer, journal, message => Console.WriteLine($"{DateTimeOffset.Now:yyyy-MM-dd HH:mm:ss} {message}")).RunAsync(cancellation.Token); }
            catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { }
            return 0;
        }
        catch (Exception error)
        {
            // No stack traces, configuration contents, tokens or invoice data in logs.
            Console.Error.WriteLine(error switch
            {
                AgentAuthenticationException => "Pairing token rejected or revoked. Create a new token in the admin panel and run --configure.",
                InvalidDataException or ArgumentException or PlatformNotSupportedException => error.Message,
                System.ComponentModel.Win32Exception => "Windows could not access the station credentials or printer service. Run under the same Windows account used for configuration.",
                IOException => "The agent data folder is unavailable, its journal is damaged, or another agent is already running. Stop the other instance and review permissions; do not delete the print journal.",
                _ => "The agent stopped unexpectedly. Review the setup guide and the Windows printer queue before restarting."
            });
            return 1;
        }
    }
}
