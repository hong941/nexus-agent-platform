from __future__ import annotations

import ast
import re


_CHINESE_DIGITS = {
    "零": 0,
    "〇": 0,
    "一": 1,
    "二": 2,
    "两": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
}
_CHINESE_UNITS = {"十": 10, "百": 100, "千": 1000}
_CHINESE_SCALES = {"万": 10_000, "亿": 100_000_000}
_CHINESE_NUMBER = "零〇一二两三四五六七八九十百千万亿"


def chinese_number_to_int(value: str) -> int:
    """Convert common Chinese integers, including values such as 一百零五 and 五万三千."""
    if not value:
        return 0
    if value.isdigit():
        return int(value)

    total = 0
    section = 0
    number = 0
    for character in value:
        if character in _CHINESE_DIGITS:
            number = _CHINESE_DIGITS[character]
        elif character in _CHINESE_UNITS:
            unit = _CHINESE_UNITS[character]
            section += (number or 1) * unit
            number = 0
        elif character in _CHINESE_SCALES:
            section += number
            total += (section or 1) * _CHINESE_SCALES[character]
            section = 0
            number = 0
        else:
            raise ValueError(f"无法识别的中文数字: {character}")
    return total + section + number


def _replace_chinese_numbers(value: str) -> str:
    pattern = re.compile(f"[{_CHINESE_NUMBER}]+")
    return pattern.sub(lambda match: str(chinese_number_to_int(match.group())), value)


def normalize_math_expression(question: str) -> str:
    """Turn common Chinese math phrasing into a safe calculator expression."""
    expression = question.strip()
    expression = re.sub(
        r"^(?:请|帮我|麻烦)?(?:计算|求值|算一下|算算|求解|请问)\s*",
        "",
        expression,
    )
    expression = re.sub(r"(?:等于多少|是多少|结果是多少|等于几)\s*[？?。]?$", "", expression)
    expression = (
        expression.replace("×", "*")
        .replace("÷", "/")
        .replace("^", "**")
        .replace("（", "(")
        .replace("）", ")")
        .replace("，", ",")
        .replace("＋", "+")
        .replace("－", "-")
        .replace("＊", "*")
        .replace("／", "/")
    )

    expression = re.sub(
        rf"([{_CHINESE_NUMBER}0-9]+)\s*的\s*([{_CHINESE_NUMBER}0-9]+)\s*次(?:方|幂)",
        lambda match: f"({_replace_chinese_numbers(match.group(1))})**({_replace_chinese_numbers(match.group(2))})",
        expression,
    )
    expression = re.sub(
        rf"([{_CHINESE_NUMBER}0-9]+)\s*的\s*平方",
        lambda match: f"({_replace_chinese_numbers(match.group(1))})**2",
        expression,
    )
    expression = re.sub(
        rf"([{_CHINESE_NUMBER}0-9]+)\s*的\s*立方",
        lambda match: f"({_replace_chinese_numbers(match.group(1))})**3",
        expression,
    )
    expression = re.sub(
        rf"([{_CHINESE_NUMBER}0-9]+)\s*分之\s*([{_CHINESE_NUMBER}0-9]+)",
        lambda match: f"({_replace_chinese_numbers(match.group(2))})/({_replace_chinese_numbers(match.group(1))})",
        expression,
    )
    expression = re.sub(
        rf"根号\s*([{_CHINESE_NUMBER}0-9.]+)",
        lambda match: f"sqrt({_replace_chinese_numbers(match.group(1))})",
        expression,
    )
    expression = _replace_chinese_numbers(expression)
    expression = (
        expression.replace("加上", "+")
        .replace("减去", "-")
        .replace("乘以", "*")
        .replace("除以", "/")
        .replace("加", "+")
        .replace("减", "-")
        .replace("乘", "*")
        .replace("除", "/")
    )
    expression = re.sub(r"\s+", "", expression).strip("：:，,。；;")
    return expression


def looks_like_math(question: str) -> bool:
    if re.search(r"\d+\s*[+\-*/^×÷%]\s*\d+", question):
        return True
    chinese_signal = re.search(
        rf"[{_CHINESE_NUMBER}]+",
        question,
    )
    math_signal = re.search(
        r"(?:计算|求值|算一下|次方|次幂|平方|立方|根号|分之|加|减|乘|除|等于多少|是多少)",
        question,
    )
    return bool(chinese_signal and math_signal)


def is_valid_expression(expression: str) -> bool:
    if not expression or not re.search(r"\d", expression):
        return False
    try:
        ast.parse(expression, mode="eval")
    except SyntaxError:
        return False
    return bool(re.search(r"[+\-*/%]|\*\*", expression))
