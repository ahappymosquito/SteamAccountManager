---
name: Steam Account Manager
description: 克制、可靠的 Steam 本地账号管理工具
colors:
  primary: "oklch(0.72 0.17 238)"
  background: "oklch(0.13 0.025 255)"
  surface: "oklch(0.18 0.028 255)"
  surface-raised: "oklch(0.23 0.030 255)"
  ink: "oklch(0.95 0.010 255)"
  muted: "oklch(0.74 0.020 255)"
  current: "oklch(0.69 0.12 240)"
  success: "oklch(0.70 0.14 145)"
  warning: "oklch(0.78 0.14 85)"
  danger: "oklch(0.64 0.18 28)"
typography:
  body:
    fontFamily: "Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  title:
    fontFamily: "Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 650
    lineHeight: 1.25
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.background}"
    rounded: "{rounded.sm}"
    padding: "8px 14px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "8px 10px"
---

# Design System: Steam Account Manager

## Overview

**Creative North Star: "安静的控制台"**

界面像一块在夜间稳定工作的设备控制台：层级清楚、反馈迅速、危险操作醒目。视觉保持紧凑和熟悉，拒绝霓虹电竞界面、玻璃拟态、装饰性动效与模板化卡片墙。

**Key Characteristics:** 暗色分层、克制橄榄强调、高信息密度、标准桌面交互、证据化状态文案。

## Colors

整体主题由 `data-theme` 和语义 CSS tokens 驱动：极光蓝为默认主题，另有脉冲紫、薄荷青和冰川白。前三套为深色，冰川白为浅色。主题只改变语义色，不改变布局或交互含义；正文与控件文字至少达到 WCAG 2.2 AA。

账号标识色固定为天蓝、青色、紫色、薄荷、珊瑚和琥珀六种键值。旧的自由颜色无法映射时只在显示层回退为天蓝，直到用户再次保存资料才写入新值。

橄榄色只用于主要操作和选中态；蓝色专用于当前 Steam 账号，语义色始终配合图标和文字。

**The Ten Percent Rule.** 品牌强调色在单屏中不超过约 10%，不得作为大面积装饰。

## Typography

使用单一系统无衬线字体栈。正文保持 14px，标题采用有限的字号与字重对比；SteamID 使用等宽数字特性并允许复制。

**The Tool Rule.** 按钮、标签和数据不使用展示字体，不使用全大写句子。

## Elevation

默认依赖色调分层和细边界表达深度；阴影仅用于对话框和浮层，不在卡片上叠加宽软阴影。

**The Flat-by-default Rule.** 静止表面保持平坦，浮层才获得阴影。

## Components

按钮、输入框、标签、列表行和导航统一使用 6–10px 圆角。每个交互控件具备 hover、focus-visible、active、disabled、loading 和 error 状态。对话框使用 Radix 焦点管理；窄窗口下侧栏折叠，不缩小正文到不可读尺寸。

## Do's and Don'ts

### Do:
- **Do** 使用图标、文字和颜色共同表达状态。
- **Do** 将危险操作与普通操作在位置、颜色和文案上明确区分。
- **Do** 保持 150–250ms 的状态过渡并尊重减少动态偏好。

### Don't:
- **Don't** 使用霓虹电竞界面、玻璃拟态或装饰性动效。
- **Don't** 制作模板化卡片墙或嵌套卡片。
- **Don't** 使用大于 1px 的彩色侧边条、渐变文字或 32px 以上卡片圆角。
- **Don't** 暗示 Valve、完美世界、5E 或 FACEIT 官方背书。
