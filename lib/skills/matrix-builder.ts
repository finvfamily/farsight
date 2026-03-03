import { z } from 'zod'
import { SkillHandler } from '@/lib/engine/skill-runtime'
import { CompareTarget, CompareMatrix } from '@/types'

// 宽松 Schema，兼容模型返回 matrix 嵌套或平铺两种格式
const MatrixSchema = z.object({
  dimensions: z.array(z.string()),
  // 支持两种格式：{ "维度": { "竞品": "值" } } 或嵌套在 matrix/cells 下
  cells: z.record(z.string(), z.record(z.string(), z.string())).optional(),
  matrix: z.record(z.string(), z.record(z.string(), z.string())).optional(),
})

const matrixBuilder: SkillHandler = {
  async execute(inputs, ctx) {
    const targets = inputs.targets as CompareTarget[]
    const query = inputs.query as string

    const targetNames = targets.map((t) => t.name)

    const targetSummaries = targets.map((t) => {
      const insightText = t.insights
        .slice(0, 10)
        .map((i) => `  - ${i.key}: ${i.value}`)
        .join('\n')
      return `## ${t.name}\n${insightText || '  （暂无详细信息）'}`
    })

    const result = await ctx.llm.extract(
      targetSummaries.join('\n\n'),
      MatrixSchema,
      `分析以下竞品，主题：${query}。
竞品列表：${targetNames.join('、')}

请输出一个对比矩阵 JSON，格式严格如下：
{
  "dimensions": ["维度1", "维度2", "维度3", "维度4", "维度5"],
  "cells": {
    "维度1": { "${targetNames[0] ?? '竞品A'}": "内容", "${targetNames[1] ?? '竞品B'}": "内容" },
    "维度2": { "${targetNames[0] ?? '竞品A'}": "内容", "${targetNames[1] ?? '竞品B'}": "内容" }
  }
}

维度建议：目标用户、核心功能、定价策略、差异化优势、技术特点。
所有内容用中文，每个单元格 10-20 字。只输出 JSON，不要解释。`
    )

    // 兼容两种返回格式
    const rawCells = result.cells ?? result.matrix ?? {}

    // 如果 cells 为空，用 dimensions 构建空矩阵兜底
    const cells: CompareMatrix['cells'] = {}
    const dimensions = result.dimensions.length > 0
      ? result.dimensions
      : ['目标用户', '核心功能', '定价策略', '差异化优势', '技术特点']

    for (const dim of dimensions) {
      cells[dim] = rawCells[dim] ?? {}
      // 补全缺失的竞品列
      for (const name of targetNames) {
        if (!cells[dim][name]) cells[dim][name] = '-'
      }
    }

    const matrix: CompareMatrix = {
      dimensions,
      targets: targetNames,
      cells,
    }

    ctx.log.info(`matrix-builder: built ${matrix.dimensions.length}x${matrix.targets.length} matrix`)
    return { matrix }
  },
}

export default matrixBuilder
