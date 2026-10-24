namespace Sinshin.PrintAgent;

/// <summary>Same 1bpp GS v 0 contract as apps/api/src/domain/print/escpos.ts.</summary>
public static class EscPosEncoder
{
    public const int FragmentRows = 960;

    public static byte[] Encode(int widthPx, int heightPx, byte[] bitmap, bool cut)
    {
        int stride = checked((widthPx + 7) / 8);
        if (widthPx is not (384 or 420 or 576) || heightPx is < 1 or > 4000 || bitmap.Length != stride * heightPx)
            throw new InvalidDataException("Invalid raster dimensions.");
        using var stream = new MemoryStream();
        stream.Write([0x1b, 0x40]); // ESC @
        for (int row = 0; row < heightPx; row += FragmentRows)
        {
            int count = Math.Min(FragmentRows, heightPx - row);
            stream.Write([0x1d, 0x76, 0x30, 0, (byte)stride, (byte)(stride >> 8), (byte)count, (byte)(count >> 8)]);
            stream.Write(bitmap, row * stride, count * stride);
        }
        // Raster commands already advance each fragment; never insert LF between them.
        stream.Write([0x0a, 0x1b, 0x64, 2]);
        if (cut) stream.Write([0x1d, 0x56, 0x42, 0]);
        stream.Write([0x1b, 0x40]);
        return stream.ToArray();
    }
}
