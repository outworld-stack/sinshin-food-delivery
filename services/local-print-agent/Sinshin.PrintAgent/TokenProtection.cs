using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace Sinshin.PrintAgent;

/// <summary>Windows DPAPI, CurrentUser scope. No token is stored in plaintext.</summary>
public static class TokenProtection
{
    public static string Protect(string token)
    {
        byte[] plain = Encoding.UTF8.GetBytes(token);
        try { return Convert.ToBase64String(Transform(plain, protect: true)); }
        finally { System.Security.Cryptography.CryptographicOperations.ZeroMemory(plain); }
    }

    public static string Unprotect(string protectedToken)
    {
        byte[] plain = Transform(Convert.FromBase64String(protectedToken), protect: false);
        try { return Encoding.UTF8.GetString(plain); }
        finally { System.Security.Cryptography.CryptographicOperations.ZeroMemory(plain); }
    }

    private static byte[] Transform(byte[] data, bool protect)
    {
        IntPtr inputMemory = Marshal.AllocHGlobal(data.Length);
        var input = new DataBlob { Length = data.Length, Data = inputMemory };
        DataBlob output = default;
        IntPtr description = IntPtr.Zero;
        try
        {
            Marshal.Copy(data, 0, inputMemory, data.Length);
            bool success = protect
                ? CryptProtectData(ref input, "Sinshin Print Agent", IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 1, out output)
                : CryptUnprotectData(ref input, out description, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 1, out output);
            if (!success) throw new Win32Exception(Marshal.GetLastWin32Error(), "Windows could not protect or read the pairing token for this account.");
            byte[] result = new byte[output.Length];
            Marshal.Copy(output.Data, result, 0, result.Length);
            return result;
        }
        finally
        {
            for (int i = 0; i < data.Length; i++) Marshal.WriteByte(inputMemory, i, 0);
            Marshal.FreeHGlobal(inputMemory);
            if (output.Data != IntPtr.Zero)
            {
                if (!protect) for (int i = 0; i < output.Length; i++) Marshal.WriteByte(output.Data, i, 0);
                LocalFree(output.Data);
            }
            if (description != IntPtr.Zero) LocalFree(description);
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DataBlob { public int Length; public IntPtr Data; }
    [DllImport("crypt32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CryptProtectData(ref DataBlob input, string description, IntPtr entropy, IntPtr reserved, IntPtr prompt, int flags, out DataBlob output);
    [DllImport("crypt32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CryptUnprotectData(ref DataBlob input, out IntPtr description, IntPtr entropy, IntPtr reserved, IntPtr prompt, int flags, out DataBlob output);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);
}
