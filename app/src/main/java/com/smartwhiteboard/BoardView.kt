package com.smartwhiteboard

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Color
import android.view.ScaleGestureDetector
import android.view.MotionEvent
import android.view.View
import kotlin.math.hypot

enum class BoardTool { PENCIL, ERASER, DUSTER, TEXT, SELECT }

class BoardView(context: Context) : View(context) {
    var state = BoardState()
        private set
    var tool = BoardTool.PENCIL
        set(value) {
            field = value
            invalidate()
        }
    var pencilColor = Color.BLACK
    var pencilWidth = 0.004f
    var dusterRadius = 0.035f
    var onChanged: (() -> Unit)? = null
    var onTextTapped: ((Int) -> Unit)? = null
    var onBackgroundTapped: ((Float, Float) -> Unit)? = null

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    private var activeStroke: BoardStroke? = null
    private var selectedText = -1
    private var movingText = -1
    private var textMoved = false
    private var panning = false
    private var scaleFactor = 1f
    private var offsetX = 0f
    private var offsetY = 0f
    private var screenLastX = 0f
    private var screenLastY = 0f
    private var lastTouchX = 0f
    private var lastTouchY = 0f
    private var dusterMoved = false
    private val undoStack = ArrayDeque<BoardState>()
    private val redoStack = ArrayDeque<BoardState>()
    private val scaleDetector = ScaleGestureDetector(context, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
        override fun onScale(detector: ScaleGestureDetector): Boolean {
            val oldScale = scaleFactor
            scaleFactor = (scaleFactor * detector.scaleFactor).coerceIn(1f, 4f)
            val ratio = scaleFactor / oldScale
            offsetX = detector.focusX - (detector.focusX - offsetX) * ratio
            offsetY = detector.focusY - (detector.focusY - offsetY) * ratio
            constrainViewport()
            invalidate()
            return true
        }
    })

    init {
        setBackgroundColor(Color.WHITE)
        isFocusable = true
    }

    fun replaceState(newState: BoardState) {
        state = newState.copyState()
        undoStack.clear()
        redoStack.clear()
        selectedText = -1
        scaleFactor = 1f
        offsetX = 0f
        offsetY = 0f
        invalidate()
        onChanged?.invoke()
    }

    fun undo() {
        if (undoStack.isEmpty()) return
        redoStack.addLast(state.copyState())
        state = undoStack.removeLast()
        invalidate()
        onChanged?.invoke()
    }

    fun redo() {
        if (redoStack.isEmpty()) return
        undoStack.addLast(state.copyState())
        state = redoStack.removeLast()
        invalidate()
        onChanged?.invoke()
    }

    fun clearBoard() {
        if (state.strokes.isEmpty() && state.texts.isEmpty()) return
        checkpoint()
        state.strokes.clear()
        state.texts.clear()
        selectedText = -1
        invalidate()
        onChanged?.invoke()
    }

    fun addText(text: String, x: Float, y: Float, color: Int, size: Float) {
        checkpoint()
        state.texts.add(BoardText(text, x.coerceIn(0.01f, 0.99f), y.coerceIn(0.02f, 0.98f), color, size))
        invalidate()
        onChanged?.invoke()
    }

    fun updateText(index: Int, text: String?, color: Int? = null, size: Float? = null) {
        if (index !in state.texts.indices) return
        checkpoint()
        if (text.isNullOrBlank()) {
            state.texts.removeAt(index)
            selectedText = -1
        } else {
            state.texts[index].text = text
            if (color != null) state.texts[index].color = color
            if (size != null) state.texts[index].size = size
        }
        invalidate()
        onChanged?.invoke()
    }

    fun updateTextStyle(index: Int, color: Int? = null, size: Float? = null) {
        if (index !in state.texts.indices || (color == null && size == null)) return
        checkpoint()
        color?.let { state.texts[index].color = it }
        size?.let { state.texts[index].size = it }
        invalidate()
        onChanged?.invoke()
    }

    fun setBoardBackground(background: String) {
        checkpoint()
        state.background = background
        invalidate()
        onChanged?.invoke()
    }

    private fun checkpoint() {
        undoStack.addLast(state.copyState())
        if (undoStack.size > 80) undoStack.removeFirst()
        redoStack.clear()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        canvas.drawColor(Color.WHITE)
        val saveCount = canvas.save()
        canvas.translate(offsetX, offsetY)
        canvas.scale(scaleFactor, scaleFactor)
        drawBackground(canvas)
        state.strokes.forEach { drawStroke(canvas, it) }
        state.texts.forEachIndexed { index, text ->
            paint.style = Paint.Style.FILL
            paint.color = text.color
            paint.textSize = text.size * width
            canvas.drawText(text.text, text.x * width, text.y * height, paint)
            if (index == selectedText) {
                paint.style = Paint.Style.STROKE
                paint.strokeWidth = 1.5f
                paint.color = Color.GRAY
                val textWidth = paint.apply { style = Paint.Style.FILL; textSize = text.size * width }.measureText(text.text)
                paint.style = Paint.Style.STROKE
                canvas.drawRect(text.x * width - 6, text.y * height - text.size * width,
                    text.x * width + textWidth + 6, text.y * height + 6, paint)
            }
        }
        if (tool == BoardTool.DUSTER && lastTouchX >= 0f && lastTouchY >= 0f) {
            paint.style = Paint.Style.STROKE
            paint.color = 0x66505C6B
            paint.strokeWidth = 2f
            val radius = dusterRadius * width
            canvas.drawCircle(lastTouchX, lastTouchY, radius, paint)
        }
        canvas.restoreToCount(saveCount)
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        constrainViewport()
    }

    private fun drawBackground(canvas: Canvas) {
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 1f
        paint.color = 0xFFE6EBF1.toInt()
        when (state.background) {
            "Lined" -> {
                var y = 44f
                while (y < height) {
                    canvas.drawLine(0f, y, width.toFloat(), y, paint)
                    y += 44f
                }
            }
            "Graph" -> {
                var x = 32f
                while (x < width) {
                    canvas.drawLine(x, 0f, x, height.toFloat(), paint)
                    x += 32f
                }
                var y = 32f
                while (y < height) {
                    canvas.drawLine(0f, y, width.toFloat(), y, paint)
                    y += 32f
                }
            }
        }
    }

    private fun drawStroke(canvas: Canvas, stroke: BoardStroke) {
        if (stroke.points.isEmpty()) return
        paint.style = Paint.Style.STROKE
        paint.color = stroke.color
        paint.strokeWidth = stroke.width * width
        val path = Path()
        path.moveTo(stroke.points.first().x * width, stroke.points.first().y * height)
        if (stroke.points.size == 1) {
            paint.style = Paint.Style.FILL
            canvas.drawCircle(stroke.points[0].x * width, stroke.points[0].y * height, stroke.width * width / 2f, paint)
            return
        }
        for (i in 1 until stroke.points.size) {
            val previous = stroke.points[i - 1]
            val current = stroke.points[i]
            val midX = (previous.x + current.x) * width / 2f
            val midY = (previous.y + current.y) * height / 2f
            path.quadTo(previous.x * width, previous.y * height, midX, midY)
        }
        val last = stroke.points.last()
        path.lineTo(last.x * width, last.y * height)
        canvas.drawPath(path, paint)
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        scaleDetector.onTouchEvent(event)
        if (event.pointerCount > 1 || scaleDetector.isInProgress) {
            panning = false
            movingText = -1
            return true
        }
        val x = (event.x - offsetX) / scaleFactor
        val y = (event.y - offsetY) / scaleFactor
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                screenLastX = event.x
                screenLastY = event.y
                lastTouchX = x
                lastTouchY = y
                dusterMoved = false
                when (tool) {
                    BoardTool.PENCIL -> {
                        checkpoint()
                        activeStroke = BoardStroke(mutableListOf(BoardPoint(x / width, y / height)), pencilColor, pencilWidth)
                        state.strokes.add(activeStroke!!)
                    }
                    BoardTool.DUSTER -> checkpoint()
                    BoardTool.TEXT -> {
                        val hit = hitText(x, y)
                        if (hit >= 0) {
                            selectedText = hit
                            onTextTapped?.invoke(hit)
                        } else {
                            onBackgroundTapped?.invoke(x / width, y / height)
                        }
                    }
                    BoardTool.SELECT -> {
                        val textHit = hitText(x, y)
                        if (textHit >= 0) {
                            selectedText = textHit
                            movingText = textHit
                            textMoved = false
                        } else {
                            panning = true
                        }
                    }
                    BoardTool.ERASER -> {
                        val textHit = hitText(x, y)
                        if (textHit >= 0) {
                            checkpoint()
                            state.texts.removeAt(textHit)
                            selectedText = -1
                            onChanged?.invoke()
                        } else eraseNearestStroke(x, y)
                    }
                }
                invalidate()
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                when (tool) {
                    BoardTool.PENCIL -> activeStroke?.points?.add(BoardPoint(x / width, y / height))
                    BoardTool.DUSTER -> {
                        val dx = x - lastTouchX
                        val dy = y - lastTouchY
                        if (hypot(dx, dy) > 2f) dusterMoved = true
                        eraseTouched(x, y)
                    }
                    BoardTool.SELECT -> {
                        if (movingText in state.texts.indices && hypot(x - lastTouchX, y - lastTouchY) > 1f) {
                            if (!textMoved) checkpoint()
                            val text = state.texts[movingText]
                            text.x = (text.x + (x - lastTouchX) / width).coerceIn(0.01f, 0.99f)
                            text.y = (text.y + (y - lastTouchY) / height).coerceIn(0.02f, 0.98f)
                            textMoved = true
                        } else if (panning) {
                            offsetX += event.x - screenLastX
                            offsetY += event.y - screenLastY
                            constrainViewport()
                        }
                    }
                    else -> Unit
                }
                screenLastX = event.x
                screenLastY = event.y
                lastTouchX = x
                lastTouchY = y
                invalidate()
                return true
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                if (tool == BoardTool.PENCIL) {
                    activeStroke = null
                    onChanged?.invoke()
                } else if (tool == BoardTool.DUSTER && dusterMoved) {
                    onChanged?.invoke()
                } else if (tool == BoardTool.SELECT && movingText >= 0) {
                    if (textMoved) onChanged?.invoke() else onTextTapped?.invoke(movingText)
                }
                movingText = -1
                panning = false
                lastTouchX = -1f
                lastTouchY = -1f
                invalidate()
                return true
            }
        }
        return true
    }

    private fun constrainViewport() {
        offsetX = offsetX.coerceIn(width * (1f - scaleFactor), 0f)
        offsetY = offsetY.coerceIn(height * (1f - scaleFactor), 0f)
    }

    private fun hitText(x: Float, y: Float): Int {
        for (index in state.texts.indices.reversed()) {
            val text = state.texts[index]
            paint.style = Paint.Style.FILL
            paint.textSize = text.size * width
            val textWidth = paint.measureText(text.text)
            val baseline = text.y * height
            val top = baseline - paint.textSize
            if (x in (text.x * width - 10)..(text.x * width + textWidth + 10) &&
                y in (top - 8)..(baseline + 8)) return index
        }
        return -1
    }

    private fun eraseNearestStroke(x: Float, y: Float) {
        val index = state.strokes.indexOfLast { stroke ->
            stroke.points.indices.any { pointIndex ->
                val point = stroke.points[pointIndex]
                val radius = maxOf(24f, stroke.width * width)
                if (pointIndex == 0) hypot(point.x * width - x, point.y * height - y) < radius
                else {
                    val previous = stroke.points[pointIndex - 1]
                    distanceToSegment(
                        x, y,
                        previous.x * width, previous.y * height,
                        point.x * width, point.y * height
                    ) < radius
                }
            }
        }
        if (index >= 0) {
            checkpoint()
            state.strokes.removeAt(index)
            invalidate()
            onChanged?.invoke()
        }
    }

    private fun eraseTouched(x: Float, y: Float) {
        val radius = dusterRadius * width
        var changed = false
        val retainedStrokes = mutableListOf<BoardStroke>()
        state.strokes.forEach { stroke ->
            val hitRadius = radius + stroke.width * width / 2f
            val retainedRuns = mutableListOf<MutableList<BoardPoint>>()
            var currentRun = mutableListOf<BoardPoint>()
            var strokeChanged = false
            fun retain(point: BoardPoint) {
                if (hypot(point.x * width - x, point.y * height - y) > hitRadius) {
                    currentRun.add(point)
                } else {
                    if (currentRun.isNotEmpty()) retainedRuns.add(currentRun)
                    currentRun = mutableListOf()
                    strokeChanged = true
                    changed = true
                }
            }

            if (stroke.points.isNotEmpty()) retain(stroke.points.first())
            for (pointIndex in 1 until stroke.points.size) {
                val previous = stroke.points[pointIndex - 1]
                val point = stroke.points[pointIndex]
                val startX = previous.x * width
                val startY = previous.y * height
                val endX = point.x * width
                val endY = point.y * height
                if (distanceToSegment(x, y, startX, startY, endX, endY) <= hitRadius) {
                    val steps = maxOf(1, (hypot(endX - startX, endY - startY) / 4f).toInt())
                    for (step in 1..steps) {
                        val fraction = step.toFloat() / steps
                        retain(BoardPoint(
                            previous.x + (point.x - previous.x) * fraction,
                            previous.y + (point.y - previous.y) * fraction
                        ))
                    }
                } else {
                    currentRun.add(point)
                }
            }
            if (currentRun.isNotEmpty()) retainedRuns.add(currentRun)
            if (!strokeChanged) {
                retainedStrokes.add(stroke)
            } else {
                retainedRuns.filter { it.isNotEmpty() }.forEach { run ->
                    retainedStrokes.add(BoardStroke(run, stroke.color, stroke.width))
                }
            }
        }
        val textRemoved = state.texts.removeAll { text ->
            paint.textSize = text.size * width
            val textWidth = paint.measureText(text.text)
            x >= text.x * width - radius && x <= text.x * width + textWidth + radius &&
                y >= text.y * height - radius - paint.textSize && y <= text.y * height + radius
        }
        if (textRemoved) selectedText = -1
        if (changed) {
            state.strokes.clear()
            state.strokes.addAll(retainedStrokes)
        }
        if (changed || textRemoved) invalidate()
    }

    private fun distanceToSegment(
        x: Float,
        y: Float,
        startX: Float,
        startY: Float,
        endX: Float,
        endY: Float
    ): Float {
        val dx = endX - startX
        val dy = endY - startY
        val lengthSquared = dx * dx + dy * dy
        if (lengthSquared == 0f) return hypot(x - startX, y - startY)
        val projection = (((x - startX) * dx + (y - startY) * dy) / lengthSquared).coerceIn(0f, 1f)
        return hypot(x - (startX + projection * dx), y - (startY + projection * dy))
    }
}
