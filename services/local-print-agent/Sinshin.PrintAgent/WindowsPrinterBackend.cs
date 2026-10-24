using System.ComponentModel;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Printing;
using System.Runtime.InteropServices;

namespace Sinshin.PrintAgent;

public static class ReceiptDimensions
{
    // Existing browser raster uses 8 dots/mm (203.2dpi). 576=72mm ink on 80mm
    // stock, 384=48mm and 420=52.5mm ink on 58mm stock. Never stretch to fill.
    public static float ContentWidthMm(int widthPx) => widthPx / 8f;
    public static float StockWidthMm(int widthPx) => widthPx == 576 ? 80f : 58f;
    public static float ContentHeightMm(int heightPx) => heightPx / 8f;
    public static int HundredthsInch(float mm) => (int)Math.Ceiling(mm * 100 / 25.4f);
}

public sealed class WindowsPrinterBackend : IPrinterBackend
{
    public IReadOnlyList<PrinterInfo> GetPrinters()
    {
        string defaultName = new PrinterSettings().PrinterName;
        return PrinterSettings.InstalledPrinters.Cast<string>()
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
            .Select(name => new PrinterInfo(name, string.Equals(name, defaultName, StringComparison.OrdinalIgnoreCase)))
            .ToArray();
    }

    public void Print(PrintClaim job, byte[] bitmap)
    {
        IReadOnlyList<PrinterInfo> printers;
        try { printers = GetPrinters(); }
        catch (Exception) { throw new PrinterFailureException("Windows printer enumeration failed before submission.", false); }
        if (!printers.Any(printer => string.Equals(printer.Name, job.PrinterName, StringComparison.Ordinal)))
            throw new PrinterFailureException("The selected Windows printer no longer exists. Refresh printers and select its replacement.", false);
        if (job.Mode == "escpos") PrintRaw(job, EscPosEncoder.Encode(job.WidthPx, job.HeightPx, bitmap, job.Cut));
        else PrintWithDriver(job, bitmap);
    }

    private static void PrintWithDriver(PrintClaim job, byte[] packed)
    {
        using Bitmap image = CreateBitmap(job.WidthPx, job.HeightPx, packed);
        using var document = new PrintDocument();
        document.PrinterSettings.PrinterName = job.PrinterName;
        if (!document.PrinterSettings.IsValid)
            throw new PrinterFailureException("The selected Windows printer is unavailable.", false);
        document.DocumentName = string.IsNullOrWhiteSpace(job.JobName) ? "Sinshin invoice" : job.JobName;
        document.PrintController = new StandardPrintController(); // No Windows print/status dialog.
        document.PrinterSettings.Copies = 1;
        document.PrinterSettings.Duplex = Duplex.Simplex;
        document.OriginAtMargins = false;
        document.DefaultPageSettings.Landscape = false;
        document.DefaultPageSettings.Color = false;
        document.DefaultPageSettings.Margins = new Margins(0, 0, 0, 0);
        float stockWidth = ReceiptDimensions.StockWidthMm(job.WidthPx);
        float inkWidth = ReceiptDimensions.ContentWidthMm(job.WidthPx);
        document.DefaultPageSettings.PaperSize = new PaperSize("Sinshin receipt",
            ReceiptDimensions.HundredthsInch(stockWidth),
            ReceiptDimensions.HundredthsInch(ReceiptDimensions.ContentHeightMm(job.HeightPx) + 4)) { RawKind = 0 };

        int nextRow = 0;
        document.PrintPage += (_, page) =>
        {
            Graphics graphics = page.Graphics ?? throw new InvalidOperationException("Windows did not provide a print surface.");
            graphics.PageUnit = GraphicsUnit.Millimeter;
            graphics.InterpolationMode = InterpolationMode.NearestNeighbor;
            graphics.PixelOffsetMode = PixelOffsetMode.Half;
            graphics.SmoothingMode = SmoothingMode.None;
            // GDI starts at the hardware printable origin. Work in physical
            // paper coordinates so the invoice keeps its exact millimetres.
            graphics.TranslateTransform(-page.PageSettings.HardMarginX * 25.4f / 100,
                -page.PageSettings.HardMarginY * 25.4f / 100);
            RectangleF printable = page.PageSettings.PrintableArea;
            float left = Math.Max((stockWidth - inkWidth) / 2, printable.Left * 25.4f / 100);
            float top = Math.Max(2, printable.Top * 25.4f / 100);
            float right = printable.Right * 25.4f / 100;
            float bottom = printable.Bottom * 25.4f / 100;
            if (right - left < inkWidth - 0.25f)
                throw new InvalidOperationException("The Windows driver printable width is smaller than the selected receipt width.");
            int rowsOnPage = Math.Min(job.HeightPx - nextRow, (int)Math.Floor((bottom - top - 1) * 8));
            if (rowsOnPage <= 0) throw new InvalidOperationException("The Windows driver returned an invalid receipt paper height.");
            graphics.DrawImage(image, new RectangleF(left, top, inkWidth, rowsOnPage / 8f),
                new Rectangle(0, nextRow, job.WidthPx, rowsOnPage), GraphicsUnit.Pixel);
            nextRow += rowsOnPage;
            page.HasMorePages = nextRow < job.HeightPx;
        };
        try { document.Print(); }
        catch (Exception)
        {
            // PrintDocument can already have submitted one or more pages.
            throw new PrinterFailureException("Windows driver submission was interrupted. Check the printer and its queue before reprinting; confirm the configured receipt paper size.", true);
        }
    }

    public static Bitmap CreateBitmap(int widthPx, int heightPx, byte[] packed)
    {
        int inputStride = (widthPx + 7) / 8;
        if (packed.Length != inputStride * heightPx) throw new InvalidDataException("Bitmap length mismatch.");
        var bitmap = new Bitmap(widthPx, heightPx, PixelFormat.Format24bppRgb);
        bitmap.SetResolution(203.2f, 203.2f);
        BitmapData data = bitmap.LockBits(new Rectangle(0, 0, widthPx, heightPx), ImageLockMode.WriteOnly, PixelFormat.Format24bppRgb);
        try
        {
            byte[] row = new byte[Math.Abs(data.Stride)];
            for (int y = 0; y < heightPx; y++)
            {
                Array.Fill(row, (byte)255);
                for (int x = 0; x < widthPx; x++)
                {
                    if ((packed[y * inputStride + x / 8] & (1 << (7 - x % 8))) != 0)
                        row[x * 3] = row[x * 3 + 1] = row[x * 3 + 2] = 0;
                }
                Marshal.Copy(row, 0, IntPtr.Add(data.Scan0, y * data.Stride), row.Length);
            }
        }
        finally { bitmap.UnlockBits(data); }
        return bitmap;
    }

    private static void PrintRaw(PrintClaim job, byte[] bytes)
    {
        if (!Native.OpenPrinter(job.PrinterName, out IntPtr handle, IntPtr.Zero))
            throw new PrinterFailureException($"Windows could not open the printer (error {Marshal.GetLastWin32Error()}).", false);
        bool started = false;
        bool completed = false;
        try
        {
            var info = new Native.DocInfo { DocumentName = job.JobName, DataType = "RAW" };
            if (Native.StartDocPrinter(handle, 1, info) == 0)
                throw new Win32Exception(Marshal.GetLastWin32Error());
            started = true;
            if (!Native.StartPagePrinter(handle)) throw new Win32Exception(Marshal.GetLastWin32Error());
            GCHandle pinned = GCHandle.Alloc(bytes, GCHandleType.Pinned);
            try
            {
                int offset = 0;
                while (offset < bytes.Length)
                {
                    int remaining = Math.Min(64 * 1024, bytes.Length - offset);
                    if (!Native.WritePrinter(handle, IntPtr.Add(pinned.AddrOfPinnedObject(), offset), remaining, out int written) || written <= 0)
                        throw new Win32Exception(Marshal.GetLastWin32Error());
                    offset += written;
                }
            }
            finally { pinned.Free(); }
            if (!Native.EndPagePrinter(handle) || !Native.EndDocPrinter(handle)) throw new Win32Exception(Marshal.GetLastWin32Error());
            completed = true;
        }
        catch (Exception)
        {
            throw new PrinterFailureException(started
                ? "ESC/POS submission was interrupted. Some paper may already have printed; check the printer before reprinting."
                : "Windows rejected the print job before submission.", started);
        }
        finally
        {
            if (started && !completed) Native.AbortPrinter(handle);
            Native.ClosePrinter(handle);
        }
    }

    private static class Native
    {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        internal sealed class DocInfo
        {
            [MarshalAs(UnmanagedType.LPWStr)] public string DocumentName = "Sinshin invoice";
            [MarshalAs(UnmanagedType.LPWStr)] public string? OutputFile;
            [MarshalAs(UnmanagedType.LPWStr)] public string DataType = "RAW";
        }
        [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
        [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
        [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
        internal static extern int StartDocPrinter(IntPtr handle, int level, [In] DocInfo info);
        [DllImport("winspool.drv", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool StartPagePrinter(IntPtr handle);
        [DllImport("winspool.drv", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool WritePrinter(IntPtr handle, IntPtr bytes, int count, out int written);
        [DllImport("winspool.drv", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool EndPagePrinter(IntPtr handle);
        [DllImport("winspool.drv", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool EndDocPrinter(IntPtr handle);
        [DllImport("winspool.drv", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool AbortPrinter(IntPtr handle);
        [DllImport("winspool.drv", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool ClosePrinter(IntPtr handle);
    }
}
