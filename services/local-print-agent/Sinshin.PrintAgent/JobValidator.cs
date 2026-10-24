using System.Security.Cryptography;
using System.Text.Json;

namespace Sinshin.PrintAgent;

public static class JobValidator
{
    public static byte[] Validate(PrintClaim job)
    {
        if (!Guid.TryParseExact(job.Id, "D", out _))
            throw new InvalidDataException("Invalid job ID.");
        if (job.ClaimToken is null || job.ClaimToken.Length != 43 || job.ClaimToken.Any(character => !char.IsAsciiLetterOrDigit(character) && character is not ('-' or '_')))
            throw new InvalidDataException("Invalid job claim token.");
        if (string.IsNullOrWhiteSpace(job.PrinterName) || job.PrinterName.Length > 256 || job.PrinterName.Any(char.IsControl))
            throw new InvalidDataException("Invalid printer name.");
        if (job.JobName is null || job.JobName.Length > 160 || job.JobName.Any(char.IsControl))
            throw new InvalidDataException("Invalid job name.");
        if (job.WidthPx is not (384 or 420 or 576) || job.HeightPx is < 1 or > 4000)
            throw new InvalidDataException("Unsupported receipt dimensions.");
        if (job.Copies != 1 || job.Mode is not ("driver" or "escpos"))
            throw new InvalidDataException("Unsupported copy count or print mode.");
        int expected = checked((job.WidthPx + 7) / 8 * job.HeightPx);
        if (job.Rows is null || job.Rows.Length != 4 * ((expected + 2) / 3))
            throw new InvalidDataException("Receipt bitmap length is invalid.");
        byte[] bitmap;
        try { bitmap = Convert.FromBase64String(job.Rows); }
        catch (FormatException) { throw new InvalidDataException("Receipt bitmap is not valid base64."); }
        if (bitmap.Length != expected)
            throw new InvalidDataException("Receipt bitmap does not match its dimensions.");
        // 420 dots leaves four padding bits. They are not image data.
        if (job.WidthPx % 8 != 0)
        {
            int stride = (job.WidthPx + 7) / 8;
            int paddingMask = (1 << (8 - job.WidthPx % 8)) - 1;
            for (int y = 0; y < job.HeightPx; y++)
                if ((bitmap[y * stride + stride - 1] & paddingMask) != 0)
                    throw new InvalidDataException("Receipt bitmap padding must be white.");
        }
        return bitmap;
    }

    public static string PayloadHash(PrintClaim job) => Convert.ToHexString(SHA256.HashData(
        JsonSerializer.SerializeToUtf8Bytes(new
        {
            job.PrinterName, job.WidthPx, job.HeightPx, job.Rows,
            job.Copies, job.Cut, job.Mode, job.JobName
        }, AgentJson.Options)));
}
