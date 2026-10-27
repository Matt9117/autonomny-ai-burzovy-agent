# Autonomous Trading Agent - Local Backend & Live Market Data Proxy
# High-Throughput Parallel Scanner (Supports 50-100+ Stocks & Crypto simultaneously)

param(
    [int]$Port = 8080
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Terminate any previous instances of server.ps1 (excluding current process and its parent shell)
try {
    $MyProc = Get-CimInstance Win32_Process -Filter "ProcessId = $PID"
    $MyParentId = $MyProc.ParentProcessId
    Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
        Where-Object { $_.ProcessId -ne $PID -and $_.ProcessId -ne $MyParentId -and $_.CommandLine -like "*server.ps1*" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 300
} catch {}

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DataDir = Join-Path $RootDir "data"
$StateFile = Join-Path $DataDir "agent_state.json"

if (-not (Test-Path $DataDir)) {
    New-Item -ItemType Directory -Path $DataDir | Out-Null
}

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13
[Net.ServicePointManager]::DefaultConnectionLimit = 64

$Listener = New-Object System.Net.HttpListener
$Prefix = "http://localhost:$Port/"
$Listener.Prefixes.Add($Prefix)

try {
    $Listener.Start()
} catch {
    $Port = 8085
    $Listener = New-Object System.Net.HttpListener
    $Prefix = "http://localhost:$Port/"
    $Listener.Prefixes.Add($Prefix)
    $Listener.Start()
}

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  AUTONOMOUS AI TRADING AGENT - PARALELNY SERVER SPUSTENY" -ForegroundColor Green
Write-Host "  URL: $Prefix" -ForegroundColor Yellow
Write-Host "  Adresar dat: $DataDir" -ForegroundColor Gray
Write-Host "============================================================" -ForegroundColor Cyan

# Create RunspacePool for fast parallel fetching of 50-100+ tickers
$RunspacePool = [runspacefactory]::CreateRunspacePool(1, 16)
$RunspacePool.Open()

$FetchScriptBlock = {
    param([string]$Symbol, [string]$Interval, [string]$Range, [int]$MaxCandles = 70)
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13
        $Encoded = [System.Uri]::EscapeDataString($Symbol)
        $Url = "https://query1.finance.yahoo.com/v8/finance/chart/$($Encoded)?interval=$Interval&range=$Range&includePrePost=true"
        $Headers = @{
            "User-Agent" = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
            "Accept" = "application/json"
        }
        $Res = Invoke-RestMethod -Uri $Url -Headers $Headers -Method Get -TimeoutSec 10
        $Result = $Res.chart.result[0]
        $Meta = $Result.meta
        $Quote = $Result.indicators.quote[0]
        $Timestamps = $Result.timestamp

        $Candles = @()
        if ($Timestamps -and $Quote) {
            $Count = $Timestamps.Count
            $StartIdx = [Math]::Max(0, $Count - $MaxCandles)
            for ($i = $StartIdx; $i -lt $Count; $i++) {
                $c = $Quote.close[$i]
                if ($null -ne $c) {
                    $Candles += @{
                        t = $Timestamps[$i]
                        o = [Math]::Round([double]($Quote.open[$i]), 4)
                        h = [Math]::Round([double]($Quote.high[$i]), 4)
                        l = [Math]::Round([double]($Quote.low[$i]), 4)
                        c = [Math]::Round([double]$c, 4)
                        v = [long]($Quote.volume[$i])
                    }
                }
            }
        }

        $PrevClose = if ($Meta.chartPreviousClose) { [double]$Meta.chartPreviousClose } elseif ($Meta.previousClose) { [double]$Meta.previousClose } else { [double]$Meta.regularMarketPrice }
        $CurrPrice = [double]$Meta.regularMarketPrice
        if ($Candles.Count -gt 0) {
            $LastCandleClose = $Candles[$Candles.Count - 1].c
            if ($LastCandleClose -gt 0) {
                $CurrPrice = $LastCandleClose
            }
        }
        $ChangePct = if ($PrevClose -gt 0) { [Math]::Round((($CurrPrice - $PrevClose) / $PrevClose) * 100, 2) } else { 0.0 }

        return @{
            ok = $true
            symbol = $Meta.symbol
            currency = $Meta.currency
            exchangeName = $Meta.exchangeName
            instrumentType = $Meta.instrumentType
            price = [Math]::Round($CurrPrice, 4)
            regularMarketPrice = [Math]::Round([double]$Meta.regularMarketPrice, 4)
            prevClose = [Math]::Round($PrevClose, 4)
            changePct = $ChangePct
            dayHigh = if ($Meta.regularMarketDayHigh) { [Math]::Round([double]$Meta.regularMarketDayHigh, 4) } else { $CurrPrice }
            dayLow = if ($Meta.regularMarketDayLow) { [Math]::Round([double]$Meta.regularMarketDayLow, 4) } else { $CurrPrice }
            volume = if ($Meta.regularMarketVolume) { [long]$Meta.regularMarketVolume } else { 0 }
            candles = $Candles
        }
    } catch {
        return @{ ok = $false; symbol = $Symbol; error = $_.Exception.Message }
    }
}

function Send-JsonResponse($Response, $DataObj, [int]$StatusCode = 200) {
    $Response.StatusCode = $StatusCode
    $Response.ContentType = "application/json; charset=utf-8"
    $Response.Headers.Add("Cache-Control", "no-cache, no-store, must-revalidate")
    $Json = $DataObj | ConvertTo-Json -Depth 12 -Compress
    $Buffer = [System.Text.Encoding]::UTF8.GetBytes($Json)
    $Response.ContentLength64 = $Buffer.Length
    $Response.OutputStream.Write($Buffer, 0, $Buffer.Length)
    $Response.OutputStream.Close()
}

function Send-TextResponse($Response, [string]$Content, [string]$ContentType = "text/plain; charset=utf-8", [int]$StatusCode = 200) {
    $Response.StatusCode = $StatusCode
    $Response.ContentType = $ContentType
    $Response.Headers.Add("Cache-Control", "no-cache")
    $Buffer = [System.Text.Encoding]::UTF8.GetBytes($Content)
    $Response.ContentLength64 = $Buffer.Length
    $Response.OutputStream.Write($Buffer, 0, $Buffer.Length)
    $Response.OutputStream.Close()
}

$CachedFxRate = 1.08
$LastFxFetch = [DateTime]::MinValue

while ($Listener.IsListening) {
    try {
        $Context = $Listener.GetContext()
        $Request = $Context.Request
        $Response = $Context.Response
        $Path = $Request.Url.AbsolutePath

        # API: Get live market data (or 5d historical candles for AI training) in parallel
        if ($Path -eq "/api/market" -or $Path -eq "/api/history") {
            $SymbolsParam = $Request.QueryString["symbols"]
            if (-not $SymbolsParam) { $SymbolsParam = "NVDA,AAPL,MSFT,TSLA,AMD,META,AMZN,GOOGL,PLTR,COIN" }
            $SymbolList = $SymbolsParam -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" } | Select-Object -Unique

            $RangeParam = if ($Request.QueryString["range"]) { $Request.QueryString["range"] } elseif ($Path -eq "/api/history") { "5d" } else { "1d" }
            $MaxCandlesParam = if ($Request.QueryString["maxCandles"]) { [int]$Request.QueryString["maxCandles"] } elseif ($Path -eq "/api/history") { 320 } else { 75 }

            # Refresh FX rate every 2 minutes
            if (([DateTime]::UtcNow - $LastFxFetch).TotalSeconds -gt 120) {
                try {
                    $PsFx = [powershell]::Create().AddScript($FetchScriptBlock).AddArgument("EURUSD=X").AddArgument("15m").AddArgument("1d").AddArgument(20)
                    $PsFx.RunspacePool = $RunspacePool
                    $FxRes = $PsFx.Invoke()
                    $PsFx.Dispose()
                    if ($FxRes -and $FxRes[0].ok -and $FxRes[0].price -gt 0.5) {
                        $CachedFxRate = $FxRes[0].price
                        $LastFxFetch = [DateTime]::UtcNow
                    }
                } catch {}
            }

            # Dispatch parallel jobs for all requested symbols
            $Jobs = @()
            foreach ($Sym in $SymbolList) {
                $Ps = [powershell]::Create().AddScript($FetchScriptBlock).AddArgument($Sym).AddArgument("5m").AddArgument($RangeParam).AddArgument($MaxCandlesParam)
                $Ps.RunspacePool = $RunspacePool
                $Jobs += @{
                    Symbol = $Sym
                    Pipe = $Ps
                    AsyncResult = $Ps.BeginInvoke()
                }
            }

            $MarketData = @{}
            foreach ($Job in $Jobs) {
                try {
                    $Res = $Job.Pipe.EndInvoke($Job.AsyncResult)
                    if ($Res -and $Res[0].ok) {
                        $Item = $Res[0]
                        $MarketData[$Job.Symbol] = $Item
                    }
                } catch {} finally {
                    $Job.Pipe.Dispose()
                }
            }

            Send-JsonResponse $Response @{
                ok = $true
                timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
                eurUsd = $CachedFxRate
                count = $MarketData.Count
                data = $MarketData
            }
            continue
        }

        # API: Get live financial news and sentiment source data
        if ($Path -eq "/api/news") {
            $Query = $Request.QueryString["q"]
            if (-not $Query) { $Query = "stock market earnings AI tech semiconductor" }
            $EncodedQ = [System.Uri]::EscapeDataString($Query)
            $Url = "https://query1.finance.yahoo.com/v1/finance/search?q=$EncodedQ&newsCount=20&quotesCount=0"
            $Headers = @{ "User-Agent" = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
            try {
                $Res = Invoke-RestMethod -Uri $Url -Headers $Headers -Method Get -TimeoutSec 8
                $Items = @()
                if ($Res.news) {
                    foreach ($n in $Res.news) {
                        $Tickers = @()
                        if ($n.relatedTickers) { $Tickers = $n.relatedTickers }
                        $Items += @{
                            uuid = $n.uuid
                            title = $n.title
                            publisher = $n.publisher
                            link = $n.link
                            publishedAt = $n.providerPublishTime
                            relatedTickers = $Tickers
                        }
                    }
                }
                Send-JsonResponse $Response @{ ok = $true; query = $Query; news = $Items }
            } catch {
                Send-JsonResponse $Response @{ ok = $false; error = $_.Exception.Message; news = @() }
            }
            continue
        }

        # API: Load or save persistent agent state
        if ($Path -eq "/api/state") {
            if ($Request.HttpMethod -eq "GET") {
                if (Test-Path $StateFile) {
                    $RawJson = Get-Content -Path $StateFile -Raw -Encoding UTF8
                    Send-TextResponse $Response $RawJson "application/json; charset=utf-8"
                } else {
                    Send-JsonResponse $Response @{ exists = $false }
                }
                continue
            }
            if ($Request.HttpMethod -eq "POST") {
                $Reader = New-Object System.IO.StreamReader($Request.InputStream, [System.Text.Encoding]::UTF8)
                $Body = $Reader.ReadToEnd()
                $Reader.Close()
                Set-Content -Path $StateFile -Value $Body -Encoding UTF8
                Send-JsonResponse $Response @{ ok = $true; savedAt = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() }
                continue
            }
        }

        # API: Broker Connector (Trading 212 / Alpaca Live & Paper Bridge)
        if ($Path -eq "/api/broker") {
            if ($Request.HttpMethod -eq "POST") {
                $Reader = New-Object System.IO.StreamReader($Request.InputStream, [System.Text.Encoding]::UTF8)
                $BodyRaw = $Reader.ReadToEnd()
                $Reader.Close()
                $Payload = $BodyRaw | ConvertFrom-Json

                $Broker = $Payload.broker
                $ApiKey = $Payload.apiKey
                $ApiSecret = $Payload.apiSecret
                $Mode = $Payload.mode
                $Action = $Payload.action

                try {
                    if ($Broker -eq "trading212") {
                        $BaseUrl = if ($Mode -eq "live") { "https://live.trading212.com/api/v0" } else { "https://demo.trading212.com/api/v0" }
                        $Headers = @{ "Authorization" = $ApiKey; "Content-Type" = "application/json" }
                        if ($Action -eq "status") {
                            $Acc = Invoke-RestMethod -Uri "$BaseUrl/equity/account/cash" -Headers $Headers -Method Get -TimeoutSec 10
                            Send-JsonResponse $Response @{ ok = $true; broker = "trading212"; account = $Acc }
                            continue
                        }
                    } elseif ($Broker -eq "alpaca") {
                        $BaseUrl = if ($Mode -eq "live") { "https://api.alpaca.markets/v2" } else { "https://paper-api.alpaca.markets/v2" }
                        $Headers = @{
                            "APCA-API-KEY-ID" = $ApiKey
                            "APCA-API-SECRET-KEY" = $ApiSecret
                            "Content-Type" = "application/json"
                        }
                        if ($Action -eq "status") {
                            $Acc = Invoke-RestMethod -Uri "$BaseUrl/account" -Headers $Headers -Method Get -TimeoutSec 10
                            Send-JsonResponse $Response @{ ok = $true; broker = "alpaca"; account = $Acc }
                            continue
                        }
                        if ($Action -eq "order") {
                            $OrderBody = @{
                                symbol = $Payload.symbol
                                notional = [string]([Math]::Round([double]$Payload.notionalUsd, 2))
                                side = $Payload.side
                                type = "market"
                                time_in_force = "day"
                            } | ConvertTo-Json
                            $OrdRes = Invoke-RestMethod -Uri "$BaseUrl/orders" -Headers $Headers -Method Post -Body $OrderBody -TimeoutSec 10
                            Send-JsonResponse $Response @{ ok = $true; broker = "alpaca"; order = $OrdRes }
                            continue
                        }
                    }
                    Send-JsonResponse $Response @{ ok = $false; error = "Nepodporovana akcia alebo broker." }
                } catch {
                    Send-JsonResponse $Response @{ ok = $false; error = $_.Exception.Message }
                }
                continue
            }
        }

        # Static files serving
        $RelPath = if ($Path -eq "/") { "index.html" } else { $Path.TrimStart("/") }
        $FullPath = Join-Path $RootDir $RelPath
        if (Test-Path $FullPath -PathType Leaf) {
            $Ext = [System.IO.Path]::GetExtension($FullPath).ToLower()
            $Mime = switch ($Ext) {
                ".html" { "text/html; charset=utf-8" }
                ".css"  { "text/css; charset=utf-8" }
                ".js"   { "application/javascript; charset=utf-8" }
                ".json" { "application/json; charset=utf-8" }
                ".svg"  { "image/svg+xml" }
                default { "application/octet-stream" }
            }
            $Bytes = [System.IO.File]::ReadAllBytes($FullPath)
            $Response.StatusCode = 200
            $Response.ContentType = $Mime
            $Response.Headers.Add("Cache-Control", "no-cache")
            $Response.ContentLength64 = $Bytes.Length
            $Response.OutputStream.Write($Bytes, 0, $Bytes.Length)
            $Response.OutputStream.Close()
        } else {
            Send-TextResponse $Response "Not Found: $Path" "text/plain; charset=utf-8" 404
        }
    } catch {
        try {
            Send-JsonResponse $Context.Response @{ ok = $false; error = $_.Exception.Message } 500
        } catch {}
    }
}
