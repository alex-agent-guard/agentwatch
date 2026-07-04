# V0 MVP 三大底层阻塞Bug（必须优先修复，否则引擎完全失效）
1. L0 Rule Engine getFieldValue() 返回undefined
   文档位置：task_l0_engine.md 第1219行
   负面影响：所有规则判断恒等于false，风险检测完全失效
2. L0 Rule Engine indexRule() 空函数体
   文档位置：task_l0_engine.md 第1224行
   负面影响：规则无法存入内存索引，匹配逻辑失效
3. MCP Proxy 方法名冲突：evaluate / match / processEvent 混用
   文档位置：task_proxy_config.md 500-507行
   负面影响：模块间接口调用报错，全检测链路断开