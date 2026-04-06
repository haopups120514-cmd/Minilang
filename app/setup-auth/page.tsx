import { generateURI } from "otplib/functional";
import QRCode from "qrcode";

export default async function SetupAuthPage() {
  const secret = process.env.TOTP_SECRET ?? "";
  const otpauth = generateURI({ secret, label: "Mimilang", issuer: "Mimilang" });
  const qrDataUrl = await QRCode.toDataURL(otpauth, { width: 240, margin: 2 });

  return (
    <div className="min-h-screen bg-[#1d1d1f] flex items-center justify-center p-8">
      <div className="bg-[#161b22] border border-white/8 rounded-2xl p-8 max-w-sm w-full text-center">
        <div className="flex items-center justify-center gap-2 mb-6">
          <div className="w-8 h-8 rounded-lg bg-[#0071e3] flex items-center justify-center">
            <svg width="16" height="13" viewBox="0 0 18 14" fill="white">
              <rect x="0"    y="10" width="2.5" height="4"  rx="1.25"/>
              <rect x="3.75" y="5"  width="2.5" height="9"  rx="1.25"/>
              <rect x="7.5"  y="0"  width="2.5" height="14" rx="1.25"/>
              <rect x="11.25" y="5" width="2.5" height="9"  rx="1.25"/>
              <rect x="15"   y="10" width="2.5" height="4"  rx="1.25"/>
            </svg>
          </div>
          <span className="text-white font-semibold text-lg">Mimilang 绑定验证器</span>
        </div>

        <p className="text-slate-400 text-sm mb-6">
          用 <strong className="text-white">Google Authenticator</strong> 扫描下方二维码，绑定后朋友注册时告诉他们 App 里的 6 位数字即可。
        </p>

        <div className="flex justify-center mb-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrDataUrl} alt="TOTP QR Code" className="rounded-xl border border-white/10" width={200} height={200} />
        </div>

        <div className="bg-[#1d1d1f] rounded-xl p-3 mb-4">
          <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-1.5">手动输入密钥（扫码失败时使用）</p>
          <p className="font-mono text-[#2997ff] text-sm tracking-wider break-all">{secret}</p>
        </div>

        <p className="text-[11px] text-slate-600">⚠️ 请勿分享此页面 · 绑定完成后可关闭</p>
      </div>
    </div>
  );
}
