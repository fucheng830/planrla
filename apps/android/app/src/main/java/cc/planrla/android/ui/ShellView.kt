package cc.planrla.android.ui

import android.annotation.SuppressLint
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import org.json.JSONObject
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView

/** Full interactive terminal: WebView running xterm.js, talking to planrla's /shell WS.
 *  Assets are inlined and the page is loaded with the server as baseURL so the page
 *  origin is http://server (ws:// then works — avoids file://→ws:// mixed-content block). */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun ShellView(
    serverUrl: String,
    token: String,
    projectPath: String?,
    modifier: Modifier = Modifier,
) {
    AndroidView(
        factory = { ctx ->
            val xtermJs = ctx.assets.open("xterm.js").bufferedReader().use { it.readText() }
            val xtermCss = ctx.assets.open("xterm.css").bufferedReader().use { it.readText() }
            val fitJs = ctx.assets.open("xterm-addon-fit.js").bufferedReader().use { it.readText() }
            val wsBase = serverUrl.replace(Regex("^http"), "ws").trimEnd('/')
            val path = projectPath.orEmpty()
            val html = buildShellHtml(xtermJs, xtermCss, fitJs, "$wsBase/shell?token=${encodeURIComponent(token)}", path)
            WebView(ctx).apply {
                layoutParams = ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT,
                )
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.mediaPlaybackRequiresUserGesture = false
                settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
                settings.useWideViewPort = true
                settings.loadWithOverviewMode = true
                webChromeClient = WebChromeClient()
                isFocusable = true
                isFocusableInTouchMode = true
                setOnClickListener { requestFocus() }
                loadDataWithBaseURL(
                    if (serverUrl.endsWith("/")) serverUrl else "$serverUrl/",
                    html, "text/html", "utf-8", null,
                )
                requestFocus()
            }
        },
        modifier = modifier.fillMaxSize(),
    )
}

private fun encodeURIComponent(value: String): String =
    java.net.URLEncoder.encode(value, Charsets.UTF_8.name()).replace("+", "%20")

private fun buildShellHtml(xtermJs: String, xtermCss: String, fitJs: String, wsUrl: String, projectPath: String): String {
    // Escape </ so an inlined script can't terminate the wrapping <script> early.
    val js = xtermJs.replace("</", "<\\/")
    val fit = fitJs.replace("</", "<\\/")
    val wsUrlJson = JSONObject.quote(wsUrl)
    val projectPathJson = JSONObject.quote(projectPath)
    return """<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>$xtermCss</style>
<style>
html,body{margin:0;padding:0;height:100%;background:#0B1120;overflow:hidden;overscroll-behavior:none;}
body{height:100dvh;}
#t{width:100vw;height:calc(100dvh - 46px);}
.xterm{height:100%;}
#shortcuts{position:fixed;left:0;right:0;bottom:0;z-index:20;display:flex;gap:6px;align-items:center;overflow-x:auto;padding:6px 8px;background:rgba(15,23,42,.96);border-top:1px solid rgba(51,65,85,.9);box-sizing:border-box;-webkit-overflow-scrolling:touch;scrollbar-width:none;}
#shortcuts::-webkit-scrollbar{display:none;}
button{flex:0 0 auto;border:1px solid #475569;border-radius:7px;background:#334155;color:#F8FAFC;font:600 12px system-ui,sans-serif;padding:7px 9px;min-width:34px;}
button:active{background:#2563EB;border-color:#2563EB;}
*{-webkit-tap-highlight-color:transparent;}
</style>
</head><body><div id="t"></div>
<div id="shortcuts">
  <button data-input="\u001b">Esc</button>
  <button data-input="\t">Tab</button>
  <button data-input="\u001b[Z">⇧Tab</button>
  <button data-input="\u0003">Ctrl-C</button>
  <button data-input="\u0004">Ctrl-D</button>
  <button data-input="\r">Enter</button>
  <button data-input="\u001b[A">↑</button>
  <button data-input="\u001b[B">↓</button>
  <button data-input="\u001b[D">←</button>
  <button data-input="\u001b[C">→</button>
</div>
<script>$js</script>
<script>$fit</script>
<script>
var SHELL_CONFIG={wsUrl:$wsUrlJson,projectPath:$projectPathJson};
(function(){
  var c=SHELL_CONFIG;
  var term=new Terminal({cursorBlink:true,fontFamily:'Menlo,Consolas,monospace',fontSize:13,lineHeight:1.25,theme:{background:'#0B1120',foreground:'#E2E8F0',cursor:'#94A3B8',selectionBackground:'#334155'},allowProposedApi:true});
  var fit=new FitAddon.FitAddon();term.loadAddon(fit);term.open(document.getElementById('t'));
  try{fit.fit();}catch(e){}
  var terminalEl=document.getElementById('t');
  function refocus(){try{term.focus();}catch(e){}}
  terminalEl.addEventListener('click',refocus);
  terminalEl.addEventListener('touchend',refocus);
  term.write('\x1b[36mConnecting to shell…\x1b[0m\r\n');
  var ws;try{ws=new WebSocket(c.wsUrl);}catch(e){term.write('\x1b[31m[bad url]\x1b[0m\r\n');return;}
  var opened=false;
  function sendInput(data){if(opened&&ws&&ws.readyState===1)ws.send(JSON.stringify({type:'input',data:data}));}
  ws.onopen=function(){
    opened=true;
    term.clear();
    try{fit.fit();}catch(e){}
    ws.send(JSON.stringify({type:'init',projectPath:c.projectPath||'.',sessionId:null,hasSession:false,provider:'plain-shell',cols:term.cols||80,rows:term.rows||24,initialCommand:null,isPlainShell:true,forceRestart:false}));
    refocus();
  };
  ws.onmessage=function(e){try{var m=JSON.parse(e.data);if(m.type==='output')term.write(m.data);else if(m.type==='error')term.write('\r\n\x1b[31m'+m.message+'\x1b[0m');}catch(_){}};
  ws.onclose=function(){term.write('\r\n\x1b[33m[disconnected]\x1b[0m\r\n');opened=false;};
  ws.onerror=function(){term.write('\r\n\x1b[31m[ws error]\x1b[0m\r\n');};
  term.onData(sendInput);
  document.querySelectorAll('#shortcuts button[data-input]').forEach(function(btn){
    btn.addEventListener('touchstart',function(ev){ev.preventDefault();sendInput(btn.getAttribute('data-input')||'');refocus();});
    btn.addEventListener('click',function(ev){ev.preventDefault();sendInput(btn.getAttribute('data-input')||'');refocus();});
  });
  window.addEventListener('resize',function(){try{fit.fit();if(opened&&ws&&ws.readyState===1)ws.send(JSON.stringify({type:'resize',cols:term.cols,rows:term.rows}));}catch(e){}});
})();
</script></body></html>"""
}

@Composable
fun ShellLoading(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text("Loading shell…", color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
