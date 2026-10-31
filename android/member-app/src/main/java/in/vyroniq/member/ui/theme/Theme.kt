package `in`.vyroniq.member.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val DarkColorScheme = darkColorScheme(
    primary = Emerald500,
    onPrimary = Color.White,
    primaryContainer = Emerald600,
    onPrimaryContainer = Color.White,
    secondary = Cyan500,
    onSecondary = Color.White,
    background = Slate950,
    onBackground = Slate100,
    surface = Slate900,
    onSurface = Slate100,
    surfaceVariant = Slate800,
    onSurfaceVariant = Slate300,
    outline = Slate700,
    error = Rose500,
    onError = Color.White
)

@Composable
fun VyroniqTheme(
    content: @Composable () -> Unit
) {
    MaterialTheme(
        colorScheme = DarkColorScheme,
        content = content
    )
}

