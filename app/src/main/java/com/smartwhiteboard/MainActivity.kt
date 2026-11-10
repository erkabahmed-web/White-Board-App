package com.smartwhiteboard

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.pdf.PdfDocument
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : Activity() {
    private lateinit var board: BoardView
    private lateinit var root: LinearLayout
    private lateinit var colorButton: Button
    private lateinit var thicknessButton: Button
    private lateinit var dusterButton: Button
    private var selectedColor = Color.BLACK
    private var selectedThickness = "Medium"
    private var selectedDusterSize = "Medium"
    private var textSize = 0.04f
    private var noteTitle = "Untitled board"
    private var currentNoteId: String? = null
    private var darkTheme = false
    private val preferences by lazy { getSharedPreferences("whiteboard", MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        darkTheme = preferences.getBoolean("darkTheme", false)
        buildInterface()
        val draft = preferences.getString("draft", null)
        if (!draft.isNullOrBlank()) {
            runCatching { board.replaceState(BoardState.fromJson(JSONObject(draft))) }
                .onFailure { Toast.makeText(this, "Couldn't restore the last board.", Toast.LENGTH_SHORT).show() }
        }
    }

    private fun buildInterface() {
        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(if (darkTheme) 0xFF151A22.toInt() else 0xFFF3F5F8.toInt())
        }
        val top = horizontalRow()
        top.addView(label("Smart Whiteboard", 18f, true), LinearLayout.LayoutParams(dp(180), -1))
        top.addView(button("Notes", ::showLibrary))
        top.addView(button("Save", ::saveNote))
        top.addView(button("Share", ::shareMenu))
        top.addView(button("Undo", { board.undo() }))
        top.addView(button("Redo", { board.redo() }))
        top.addView(button("More", ::showMore))
        root.addView(horizontalScroll(top))

        board = BoardView(this)
        board.setBackgroundColor(Color.WHITE)
        root.addView(board, LinearLayout.LayoutParams(-1, 0, 1f).apply {
            setMargins(dp(10), dp(6), dp(10), dp(6))
        })
        board.onChanged = { saveDraft() }
        board.onBackgroundTapped = { x, y -> showTextEditor(null, x, y) }
        board.onTextTapped = { index -> showTextActions(index) }

        val bottom = horizontalRow()
        bottom.addView(button("Pencil") { board.tool = BoardTool.PENCIL })
        colorButton = button("Color", ::chooseColor).apply { tag = "pencil-color" }
        thicknessButton = button("Thickness: $selectedThickness", ::chooseThickness)
        dusterButton = button("Duster: $selectedDusterSize", ::chooseDuster)
        bottom.addView(colorButton)
        bottom.addView(thicknessButton)
        bottom.addView(button("Eraser") { board.tool = BoardTool.ERASER })
        bottom.addView(dusterButton)
        bottom.addView(button("Text") { board.tool = BoardTool.TEXT })
        bottom.addView(button("Select") { board.tool = BoardTool.SELECT })
        root.addView(horizontalScroll(bottom))
        setContentView(root)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            view.setPadding(view.paddingLeft, systemBars.top, view.paddingRight, systemBars.bottom)
            insets
        }
        ViewCompat.requestApplyInsets(root)
        refreshColorButton()
        applyTheme()
    }

    private fun showMore() {
        val options = arrayOf("New board", "Clear all", "Background", "Notes library", "Export editable file", if (darkTheme) "Light theme" else "Dark theme")
        AlertDialog.Builder(this).setTitle("More options").setItems(options) { _, which ->
            when (which) {
                0 -> createNewBoard()
                1 -> confirmClear()
                2 -> chooseBackground()
                3 -> showLibrary()
                4 -> shareFile("application/json", "whiteboard.swhiteboard", board.state.toJson().toString())
                5 -> {
                    darkTheme = !darkTheme
                    preferences.edit().putBoolean("darkTheme", darkTheme).apply()
                    applyTheme()
                }
            }
        }.show()
    }

    private fun createNewBoard() {
        AlertDialog.Builder(this).setTitle("Start a new board?")
            .setMessage("Unsaved work will be replaced. Saved notes in your library won't be affected.")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("New board") { _, _ ->
                board.replaceState(BoardState())
                noteTitle = "Untitled board"
                currentNoteId = null
                saveDraft()
            }.show()
    }

    private fun chooseColor() {
        val colors = intArrayOf(Color.BLACK, Color.RED, Color.BLUE, Color.GREEN, Color.YELLOW, 0xFFFF9800.toInt(), 0xFF9C27B0.toInt())
        val names = arrayOf("Black", "Red", "Blue", "Green", "Yellow", "Orange", "Purple", "Custom…")
        AlertDialog.Builder(this).setTitle("Pencil color").setItems(names) { _, which ->
            if (which < colors.size) {
                selectedColor = colors[which]
                board.pencilColor = selectedColor
                refreshColorButton()
            } else {
                val input = EditText(this).apply { hint = "#RRGGBB" }
                AlertDialog.Builder(this).setTitle("Custom color").setView(input)
                    .setPositiveButton("Apply") { _, _ ->
                        val parsed = runCatching { Color.parseColor(input.text.toString()) }.getOrNull()
                        if (parsed == null) toast("Enter a valid color such as #3456AA")
                        else {
                            selectedColor = parsed
                            board.pencilColor = parsed
                            refreshColorButton()
                        }
                    }.setNegativeButton("Cancel", null).show()
            }
        }.show()
    }

    private fun chooseThickness() {
        val labels = arrayOf("Fine", "Medium", "Thick", "Extra thick")
        val values = floatArrayOf(0.0025f, 0.0045f, 0.008f, 0.013f)
        AlertDialog.Builder(this).setTitle("Pencil thickness").setItems(labels) { _, which ->
            board.pencilWidth = values[which]
            selectedThickness = labels[which]
            thicknessButton.text = "Thickness: $selectedThickness"
        }.show()
    }

    private fun chooseDuster() {
        val labels = arrayOf("Small", "Medium", "Large", "Extra large")
        val values = floatArrayOf(0.018f, 0.032f, 0.05f, 0.075f)
        AlertDialog.Builder(this).setTitle("Duster size").setItems(labels) { _, which ->
            board.dusterRadius = values[which]
            selectedDusterSize = labels[which]
            dusterButton.text = "Duster: $selectedDusterSize"
            board.tool = BoardTool.DUSTER
        }.show()
    }

    private fun chooseBackground() {
        AlertDialog.Builder(this).setTitle("Board background")
            .setItems(arrayOf("Blank", "Lined", "Graph")) { _, which ->
                board.setBoardBackground(arrayOf("Blank", "Lined", "Graph")[which])
            }.show()
    }

    private fun confirmClear() {
        AlertDialog.Builder(this).setTitle("Clear this board?")
            .setMessage("All writing and text on this board will be removed. This can be undone.")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Clear") { _, _ -> board.clearBoard() }
            .show()
    }

    private fun showTextEditor(existing: BoardText?, x: Float = 0.1f, y: Float = 0.15f, index: Int = -1) {
        val input = EditText(this).apply {
            setText(existing?.text.orEmpty())
            hint = "Type your note"
            textSize = 18f
        }
        AlertDialog.Builder(this).setTitle(if (existing == null) "Add text" else "Edit text")
            .setView(input)
            .setPositiveButton(if (existing == null) "Add" else "Update") { _, _ ->
                val text = input.text.toString().trim()
                if (text.isNotEmpty()) {
                    if (existing == null) board.addText(text, x, y, selectedColor, textSize)
                    else board.updateText(index, text)
                }
            }
            .setNeutralButton("Text style") { _, _ -> chooseTextStyle() }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun showTextActions(index: Int) {
        if (index !in board.state.texts.indices) return
        val item = board.state.texts[index]
        AlertDialog.Builder(this).setTitle("Text")
            .setItems(arrayOf("Edit text", "Change size", "Change color", "Delete text")) { _, which ->
                when (which) {
                    0 -> showTextEditor(item, index = index)
                    1 -> chooseExistingTextSize(index)
                    2 -> chooseExistingTextColor(index)
                    3 -> board.updateText(index, null)
                }
            }.show()
    }

    private fun chooseExistingTextSize(index: Int) {
        AlertDialog.Builder(this).setTitle("Text size")
            .setItems(arrayOf("Small", "Medium", "Large")) { _, which ->
                board.updateTextStyle(index, size = floatArrayOf(0.03f, 0.04f, 0.055f)[which])
            }.show()
    }

    private fun chooseExistingTextColor(index: Int) {
        val colors = intArrayOf(Color.BLACK, Color.RED, Color.BLUE, Color.GREEN, Color.YELLOW, 0xFFFF9800.toInt(), 0xFF9C27B0.toInt())
        val names = arrayOf("Black", "Red", "Blue", "Green", "Yellow", "Orange", "Purple")
        AlertDialog.Builder(this).setTitle("Text color").setItems(names) { _, which ->
            board.updateTextStyle(index, color = colors[which])
        }.setNeutralButton("Custom…") { _, _ ->
            val input = EditText(this).apply { hint = "#RRGGBB" }
            AlertDialog.Builder(this).setTitle("Custom text color").setView(input)
                .setPositiveButton("Apply") { _, _ ->
                    val parsed = runCatching { Color.parseColor(input.text.toString()) }.getOrNull()
                    if (parsed == null) toast("Enter a valid color such as #3456AA")
                    else board.updateTextStyle(index, color = parsed)
                }.setNegativeButton("Cancel", null).show()
        }.show()
    }

    private fun chooseTextStyle() {
        val colors = intArrayOf(Color.BLACK, Color.RED, Color.BLUE, Color.GREEN, 0xFF9C27B0.toInt())
        val names = arrayOf("Black", "Red", "Blue", "Green", "Purple")
        AlertDialog.Builder(this).setTitle("Text color").setItems(names) { _, which ->
            selectedColor = colors[which]
            chooseTextSize()
        }.show()
    }

    private fun chooseTextSize() {
        AlertDialog.Builder(this).setTitle("Text size")
            .setItems(arrayOf("Small", "Medium", "Large")) { _, which ->
                textSize = floatArrayOf(0.03f, 0.04f, 0.055f)[which]
            }.show()
    }

    private fun saveNote() {
        val input = EditText(this).apply {
            setText(noteTitle.takeUnless { it == "Untitled board" }.orEmpty())
            hint = "Note title"
        }
        AlertDialog.Builder(this).setTitle("Save whiteboard").setView(input)
            .setPositiveButton("Save") { _, _ ->
                val title = input.text.toString().trim().ifBlank { "Untitled board" }
                noteTitle = title
                val notes = readNotes() ?: return@setPositiveButton
                val savedAt = System.currentTimeMillis()
                val id = currentNoteId ?: savedAt.toString()
                val note = JSONObject()
                    .put("id", id)
                    .put("title", title)
                    .put("savedAt", savedAt)
                    .put("board", board.state.toJson())
                var existingIndex = -1
                for (i in 0 until notes.length()) {
                    if (notes.optJSONObject(i)?.optString("id") == id) {
                        existingIndex = i
                        break
                    }
                }
                if (existingIndex >= 0) notes.put(existingIndex, note) else notes.put(note)
                currentNoteId = id
                preferences.edit().putString("notes", notes.toString()).apply()
                saveDraft()
                toast("“$title” saved")
            }
            .setNegativeButton("Cancel", null).show()
    }

    private fun showLibrary() {
        val notes = readNotes() ?: return
        if (notes.length() == 0) {
            toast("No saved notes yet")
            return
        }
        val items = (0 until notes.length()).mapNotNull { notes.optJSONObject(it) }
        val labels = items.map {
            val date = SimpleDateFormat("MMM d, yyyy · h:mm a", Locale.getDefault())
                .format(Date(it.optLong("savedAt")))
            "${it.optString("title")}  ·  $date"
        }.toTypedArray()
        AlertDialog.Builder(this).setTitle("Notes library").setItems(labels) { _, which ->
            val note = items[which]
            AlertDialog.Builder(this).setTitle(note.optString("title"))
                .setItems(arrayOf("Open", "Rename", "Delete")) { _, action ->
                    when (action) {
                        0 -> {
                            board.replaceState(BoardState.fromJson(note.optJSONObject("board") ?: JSONObject()))
                            noteTitle = note.optString("title")
                            currentNoteId = note.optString("id")
                            toast("Note opened")
                        }
                        1 -> renameNote(note.optString("id"))
                        2 -> deleteNote(note.optString("id"))
                    }
                }.show()
        }.show()
    }

    private fun renameNote(id: String) {
        val notes = readNotes() ?: return
        val note = (0 until notes.length()).mapNotNull { notes.optJSONObject(it) }.firstOrNull { it.optString("id") == id } ?: return
        val input = EditText(this).apply { setText(note.optString("title")) }
        AlertDialog.Builder(this).setTitle("Rename note").setView(input)
            .setPositiveButton("Save") { _, _ ->
                val title = input.text.toString().trim().ifBlank { "Untitled board" }
                note.put("title", title)
                preferences.edit().putString("notes", notes.toString()).apply()
                if (currentNoteId == id) noteTitle = title
                toast("Note renamed")
            }.setNegativeButton("Cancel", null).show()
    }

    private fun deleteNote(id: String) {
        AlertDialog.Builder(this).setTitle("Delete saved note?")
            .setMessage("This note will be removed from your library.")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Delete") { _, _ ->
                val current = readNotes() ?: return@setPositiveButton
                val updated = JSONArray()
                for (i in 0 until current.length()) {
                    val note = current.optJSONObject(i) ?: continue
                    if (note.optString("id") != id) updated.put(note)
                }
                preferences.edit().putString("notes", updated.toString()).apply()
                if (currentNoteId == id) {
                    currentNoteId = null
                    noteTitle = "Untitled board"
                }
                toast("Note deleted")
            }.show()
    }

    private fun shareMenu() {
        AlertDialog.Builder(this).setTitle("Share whiteboard")
            .setItems(arrayOf("Share as PNG", "Share as PDF", "Share editable file", "Share text")) { _, which ->
                when (which) {
                    0 -> sharePng()
                    1 -> sharePdf()
                    2 -> shareFile("application/json", "whiteboard.swhiteboard", board.state.toJson().toString())
                    3 -> {
                        val text = board.state.texts.joinToString("\n") { it.text }
                        if (text.isBlank()) toast("There is no typed text to share")
                        else startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                            type = "text/plain"
                            putExtra(Intent.EXTRA_TEXT, text)
                        }, "Share text"))
                    }
                }
            }.show()
    }

    private fun sharePng() {
        val bitmap = renderBitmap()
        val file = File(cacheDir, "whiteboard.png")
        file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
        shareFileUri(file, "image/png")
    }

    private fun sharePdf() {
        val bitmap = renderBitmap()
        val document = PdfDocument()
        val page = document.startPage(PdfDocument.PageInfo.Builder(bitmap.width, bitmap.height, 1).create())
        page.canvas.drawBitmap(bitmap, 0f, 0f, Paint(Paint.ANTI_ALIAS_FLAG))
        document.finishPage(page)
        val file = File(cacheDir, "whiteboard.pdf")
        file.outputStream().use { document.writeTo(it) }
        document.close()
        bitmap.recycle()
        shareFileUri(file, "application/pdf")
    }

    private fun renderBitmap(): Bitmap {
        val outputWidth = 1200
        val outputHeight = (outputWidth * board.height.toFloat() / board.width.coerceAtLeast(1)).toInt().coerceAtLeast(1)
        val bitmap = Bitmap.createBitmap(outputWidth, outputHeight, Bitmap.Config.ARGB_8888)
        val exportBoard = BoardView(this)
        exportBoard.layout(0, 0, bitmap.width, bitmap.height)
        exportBoard.replaceState(board.state)
        exportBoard.draw(Canvas(bitmap))
        return bitmap
    }

    private fun shareFile(mimeType: String, fileName: String, contents: String) {
        val file = File(cacheDir, fileName)
        file.writeText(contents)
        shareFileUri(file, mimeType)
    }

    private fun shareFileUri(file: File, mimeType: String) {
        val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = mimeType
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        startActivity(Intent.createChooser(intent, "Share whiteboard"))
        toast("Choose an app to share your whiteboard")
    }

    private fun readNotes(): JSONArray? {
        val stored = preferences.getString("notes", null) ?: return JSONArray()
        return try {
            JSONArray(stored)
        } catch (_: JSONException) {
            toast("Saved notes could not be read. They were left unchanged.")
            null
        }
    }

    private fun applyTheme() {
        val background = if (darkTheme) 0xFF151A22.toInt() else 0xFFF3F5F8.toInt()
        val bar = if (darkTheme) 0xFF202734.toInt() else Color.WHITE
        root.setBackgroundColor(background)
        window.statusBarColor = background
        window.navigationBarColor = background
        WindowInsetsControllerCompat(window, root).apply {
            isAppearanceLightStatusBars = !darkTheme
            isAppearanceLightNavigationBars = !darkTheme
        }
        for (index in 0 until root.childCount) {
            val scroll = root.getChildAt(index) as? HorizontalScrollView ?: continue
            val row = scroll.getChildAt(0) as? LinearLayout ?: continue
            row.setBackgroundColor(bar)
            for (childIndex in 0 until row.childCount) applyThemeToView(row.getChildAt(childIndex))
        }
    }

    private fun applyThemeToView(view: View) {
        when (view) {
            is Button -> {
                if (view === colorButton) {
                    refreshColorButton()
                } else {
                    view.setTextColor(if (darkTheme) 0xFFF1F4F8.toInt() else 0xFF172033.toInt())
                    view.backgroundTintList = if (darkTheme) ColorStateList.valueOf(0xFF343E50.toInt()) else null
                }
            }
            is TextView -> view.setTextColor(if (darkTheme) 0xFFF1F4F8.toInt() else 0xFF172033.toInt())
        }
        if (view is ViewGroup) {
            for (index in 0 until view.childCount) applyThemeToView(view.getChildAt(index))
        }
    }

    private fun refreshColorButton() {
        if (!::colorButton.isInitialized) return
        colorButton.backgroundTintList = ColorStateList.valueOf(selectedColor)
        val luminance = 0.299 * Color.red(selectedColor) + 0.587 * Color.green(selectedColor) + 0.114 * Color.blue(selectedColor)
        colorButton.setTextColor(if (luminance < 140) Color.WHITE else Color.BLACK)
    }

    private fun saveDraft() {
        if (::board.isInitialized) preferences.edit().putString("draft", board.state.toJson().toString()).apply()
    }

    override fun onPause() {
        saveDraft()
        super.onPause()
    }

    private fun button(text: String, action: () -> Unit) = Button(this).apply {
        this.text = text
        isAllCaps = false
        textSize = 13f
        minHeight = dp(44)
        minWidth = dp(56)
        setPadding(dp(8), 0, dp(8), 0)
        setOnClickListener { action() }
    }

    private fun label(text: String, size: Float, bold: Boolean) = TextView(this).apply {
        this.text = text
        textSize = size
        if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
        gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(12), 0, dp(8), 0)
        setTextColor(if (darkTheme) 0xFFF1F4F8.toInt() else 0xFF172033.toInt())
    }

    private fun horizontalRow() = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setBackgroundColor(Color.WHITE)
        layoutParams = LinearLayout.LayoutParams(-1, dp(52))
    }

    private fun horizontalScroll(row: View): HorizontalScrollView =
        HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            addView(row, ViewGroup.LayoutParams(-2, -1))
            layoutParams = LinearLayout.LayoutParams(-1, dp(54))
        }

    private fun toast(message: String) = Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
