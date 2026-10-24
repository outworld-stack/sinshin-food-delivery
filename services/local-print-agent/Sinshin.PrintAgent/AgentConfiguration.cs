using System.Text.Json;
using System.Security.Cryptography;
using System.Text;

namespace Sinshin.PrintAgent;

public sealed record AgentConfiguration(string ApiBaseUrl, string ProtectedToken)
{
    public string StationDirectory(string dataDirectory, string decryptedToken)
    {
        // Re-pairing cannot acknowledge the previous station's claims. Preserve
        // its receipts separately; re-entering the same token reuses its journal.
        string identity = ValidateApiBaseUrl(ApiBaseUrl).AbsoluteUri + "\n" + decryptedToken;
        string fingerprint = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(identity)));
        return Path.Combine(dataDirectory, "stations", fingerprint);
    }

    public static Uri ValidateApiBaseUrl(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out Uri? uri) ||
            !string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment) ||
            !uri.AbsolutePath.TrimEnd('/').EndsWith("/api", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Use the API base URL shown in the admin print panel, ending in /api.");
        if (uri.Scheme != "https" && !(uri.Scheme == "http" && uri.IsLoopback))
            throw new InvalidDataException("The production print server must use HTTPS. HTTP is allowed only for local development.");
        return new Uri(uri.AbsoluteUri.TrimEnd('/') + "/");
    }

    public static AgentConfiguration Load(string dataDirectory)
    {
        string path = Path.Combine(dataDirectory, "agent.json");
        if (!File.Exists(path)) throw new InvalidDataException("This station is not configured. Run Sinshin.PrintAgent.exe --configure first.");
        var configuration = JsonSerializer.Deserialize<AgentConfiguration>(File.ReadAllText(path), AgentJson.Options)
            ?? throw new InvalidDataException("The agent configuration could not be read.");
        ValidateApiBaseUrl(configuration.ApiBaseUrl);
        if (string.IsNullOrWhiteSpace(configuration.ProtectedToken)) throw new InvalidDataException("The station has no pairing token. Configure it again.");
        return configuration;
    }

    public static void Configure(string dataDirectory)
    {
        Console.Write("API base URL from the admin print panel (https://your-site/api): ");
        string url = Console.ReadLine()?.Trim() ?? "";
        ValidateApiBaseUrl(url);
        Console.Write("Paste the one-time pairing token (hidden), then press Enter: ");
        string token = ReadSecret();
        if (token.Length < 32 || token.Length > 512 || token.Any(char.IsWhiteSpace))
            throw new InvalidDataException("The pairing token is invalid. Copy the complete token from the admin panel.");
        AtomicFile.WriteJson(Path.Combine(dataDirectory, "agent.json"), new AgentConfiguration(url.TrimEnd('/'), TokenProtection.Protect(token)));
        Console.WriteLine("Configuration saved for this Windows account. The token is encrypted with Windows DPAPI.");
        Console.WriteLine("Start the agent without --configure. No test receipt is printed during setup.");
    }

    private static string ReadSecret()
    {
        // Redirection is useful for an operator-managed secret pipe, never logs it.
        if (Console.IsInputRedirected) return Console.ReadLine()?.Trim() ?? "";
        var characters = new List<char>();
        while (true)
        {
            ConsoleKeyInfo key = Console.ReadKey(intercept: true);
            if (key.Key == ConsoleKey.Enter) { Console.WriteLine(); return new string(characters.ToArray()).Trim(); }
            if (key.Key == ConsoleKey.Backspace) { if (characters.Count > 0) characters.RemoveAt(characters.Count - 1); }
            else if (!char.IsControl(key.KeyChar) && characters.Count < 512) characters.Add(key.KeyChar);
        }
    }
}
