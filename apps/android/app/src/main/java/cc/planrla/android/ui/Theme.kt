package cc.planrla.android.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// planrla web palette — shadcn/ui HSL tokens (src/index.css)
// primary 221.2 83.2% 53.3% = #3B82F6 (blue-600)
private val Primary = Color(0xFF3B82F6)

private val LightColors = lightColorScheme(
    primary = Primary,
    onPrimary = Color(0xFFF8FAFC),
    primaryContainer = Color(0xFFDBEAFE),
    onPrimaryContainer = Color(0xFF1E3A8A),
    secondary = Color(0xFFF1F5F9),
    onSecondary = Color(0xFF0F172A),
    secondaryContainer = Color(0xFFE2E8F0),
    onSecondaryContainer = Color(0xFF1E293B),
    tertiary = Color(0xFFE0E7FF),
    background = Color(0xFFFFFFFF),
    onBackground = Color(0xFF0F172A),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF0F172A),
    surfaceVariant = Color(0xFFF1F5F9),
    onSurfaceVariant = Color(0xFF64748B),
    surfaceTint = Primary,
    outline = Color(0xFFE2E8F0),
    outlineVariant = Color(0xFFF1F5F9),
    error = Color(0xFFEF4444),
    onError = Color(0xFFFFFFFF),
)

private val DarkColors = darkColorScheme(
    primary = Primary,
    onPrimary = Color(0xFFF8FAFC),
    primaryContainer = Color(0xFF1E3A8A),
    onPrimaryContainer = Color(0xFFDBEAFE),
    secondary = Color(0xFF1E293B),
    onSecondary = Color(0xFFF1F5F9),
    secondaryContainer = Color(0xFF334155),
    onSecondaryContainer = Color(0xFFF1F5F9),
    tertiary = Color(0xFF1E293B),
    background = Color(0xFF0B1120),
    onBackground = Color(0xFFF8FAFC),
    surface = Color(0xFF0F172A),  // slate-900 — matches web dark --card
    onSurface = Color(0xFFF8FAFC),
    surfaceVariant = Color(0xFF1E293B),
    onSurfaceVariant = Color(0xFF94A3B8),
    surfaceTint = Primary,
    outline = Color(0xFF334155),
    outlineVariant = Color(0xFF1E293B),
    error = Color(0xFFEF4444),
    onError = Color(0xFFFFFFFF),
)

@Composable
fun NomadTheme(content: @Composable () -> Unit) {
    val dark = App.settings.darkMode
    MaterialTheme(
        colorScheme = if (dark) DarkColors else LightColors,
        content = content
    )
}
