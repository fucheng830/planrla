package cc.planrla.android.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.concurrent.TimeUnit

data class HostCandidate(
    val url: String,
    val name: String,
    val version: String? = null,
)

object HostScanner {
    private val client = OkHttpClient.Builder()
        .connectTimeout(700, TimeUnit.MILLISECONDS)
        .readTimeout(900, TimeUnit.MILLISECONDS)
        .callTimeout(1200, TimeUnit.MILLISECONDS)
        .build()
    private val json = Json { ignoreUnknownKeys = true }

    suspend fun scan(ports: List<Int> = listOf(3001, 3002)): List<HostCandidate> = withContext(Dispatchers.IO) {
        val bases = localIpv4Prefixes().flatMap { prefix ->
            (1..254).flatMap { host -> ports.map { port -> "http://$prefix.$host:$port" } }
        }.toMutableList()

        bases += listOf("http://10.0.2.2:3001", "http://10.0.2.2:3002")

        coroutineScope {
            val limit = Semaphore(48)
            bases.distinct().map { url ->
                async {
                    limit.withPermit { probe(url) }
                }
            }.awaitAll().filterNotNull().distinctBy { it.url }
        }
    }

    suspend fun test(url: String): HostCandidate? = withContext(Dispatchers.IO) {
        probe(normalizeUrl(url))
    }

    private fun probe(baseUrl: String): HostCandidate? = runCatching {
        val request = Request.Builder().url("${baseUrl.trimEnd('/')}/health").get().build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) return@runCatching null
            val body = response.body?.string().orEmpty()
            val root = runCatching { json.parseToJsonElement(body).jsonObject }.getOrNull()
            val status = root?.get("status")?.jsonPrimitive?.content
            if (status != "ok") return@runCatching null
            val version = root["version"]?.jsonPrimitive?.content
            HostCandidate(baseUrl.trimEnd('/'), "planrla ${baseUrl.removePrefix("http://")}", version)
        }
    }.getOrNull()

    private fun normalizeUrl(input: String): String {
        val trimmed = input.trim().trimEnd('/')
        return if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) trimmed else "http://$trimmed"
    }

    private fun localIpv4Prefixes(): List<String> {
        return NetworkInterface.getNetworkInterfaces().toList()
            .filter { it.isUp && !it.isLoopback && !it.isVirtual }
            .flatMap { iface -> iface.inetAddresses.toList() }
            .filterIsInstance<Inet4Address>()
            .map { it.hostAddress }
            .filterNot { it.startsWith("127.") || it.startsWith("169.254.") }
            .mapNotNull { address -> address.substringBeforeLast('.', missingDelimiterValue = "") }
            .filter { it.isNotBlank() }
            .distinct()
    }
}

