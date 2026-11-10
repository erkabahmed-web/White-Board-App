package com.smartwhiteboard

import android.graphics.Color
import org.json.JSONArray
import org.json.JSONObject

data class BoardPoint(var x: Float, var y: Float)

data class BoardStroke(
    val points: MutableList<BoardPoint>,
    var color: Int,
    var width: Float
) {
    fun copyStroke() = BoardStroke(points.map { BoardPoint(it.x, it.y) }.toMutableList(), color, width)
}

data class BoardText(
    var text: String,
    var x: Float,
    var y: Float,
    var color: Int,
    var size: Float
)

data class BoardState(
    val strokes: MutableList<BoardStroke> = mutableListOf(),
    val texts: MutableList<BoardText> = mutableListOf(),
    var background: String = "Blank"
) {
    fun copyState() = BoardState(
        strokes.map { it.copyStroke() }.toMutableList(),
        texts.map { it.copy() }.toMutableList(),
        background
    )

    fun toJson(): JSONObject {
        val result = JSONObject()
        result.put("version", 1)
        result.put("background", background)
        val strokeArray = JSONArray()
        strokes.forEach { stroke ->
            val item = JSONObject()
            item.put("color", stroke.color)
            item.put("width", stroke.width)
            val points = JSONArray()
            stroke.points.forEach { point ->
                points.put(JSONArray().put(point.x.toDouble()).put(point.y.toDouble()))
            }
            item.put("points", points)
            strokeArray.put(item)
        }
        val textArray = JSONArray()
        texts.forEach { text ->
            textArray.put(JSONObject()
                .put("text", text.text)
                .put("x", text.x.toDouble())
                .put("y", text.y.toDouble())
                .put("color", text.color)
                .put("size", text.size))
        }
        result.put("strokes", strokeArray)
        result.put("texts", textArray)
        return result
    }

    companion object {
        fun fromJson(json: JSONObject): BoardState {
            val state = BoardState(background = json.optString("background", "Blank"))
            val strokeArray = json.optJSONArray("strokes") ?: JSONArray()
            for (i in 0 until strokeArray.length()) {
                val item = strokeArray.optJSONObject(i) ?: continue
                val points = mutableListOf<BoardPoint>()
                val pointArray = item.optJSONArray("points") ?: JSONArray()
                for (j in 0 until pointArray.length()) {
                    val point = pointArray.optJSONArray(j) ?: continue
                    if (point.length() >= 2) {
                        points.add(BoardPoint(point.optDouble(0).toFloat(), point.optDouble(1).toFloat()))
                    }
                }
                if (points.isNotEmpty()) {
                    state.strokes.add(BoardStroke(points, item.optInt("color", Color.BLACK), item.optDouble("width", 0.005).toFloat()))
                }
            }
            val textArray = json.optJSONArray("texts") ?: JSONArray()
            for (i in 0 until textArray.length()) {
                val item = textArray.optJSONObject(i) ?: continue
                state.texts.add(BoardText(
                    item.optString("text"),
                    item.optDouble("x").toFloat(),
                    item.optDouble("y").toFloat(),
                    item.optInt("color", Color.BLACK),
                    item.optDouble("size", 0.035).toFloat()
                ))
            }
            return state
        }
    }
}
