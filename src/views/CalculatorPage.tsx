import { useState, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";

const CalculatorPage = () => {
  const [display, setDisplay] = useState("0");
  const [expression, setExpression] = useState("");
  const [hasResult, setHasResult] = useState(false);
  const [isShift, setIsShift] = useState(false);
  const [isDeg, setIsDeg] = useState(true);
  const lastAnswer = useRef("0");
  const { lang } = useLanguage();

  const toRad = (v: number) => isDeg ? (v * Math.PI) / 180 : v;
  const fromRad = (v: number) => isDeg ? (v * 180) / Math.PI : v;

  const handleNumber = (num: string) => {
    if (hasResult) {
      setDisplay(num);
      setExpression(num);
      setHasResult(false);
    } else {
      const newDisplay = display === "0" && num !== "." ? num : display + num;
      setDisplay(newDisplay);
      setExpression(expression === "" && display === "0" ? num : expression + num);
    }
  };

  const handleOperator = (op: string) => {
    setHasResult(false);
    const lastChar = expression.slice(-1);
    if (["+", "-", "*", "/", "^"].includes(lastChar)) {
      setExpression(expression.slice(0, -1) + op);
    } else {
      setExpression(expression + op);
    }
    setDisplay("0");
  };

  const handleParenthesis = (p: string) => {
    setHasResult(false);
    setExpression(expression + p);
    if (p === "(") setDisplay("0");
  };

  const handleScientificFunc = (func: string) => {
    try {
      // Try to evaluate the full expression first, fallback to display
      let current: number;
      if (hasResult) {
        current = parseFloat(display);
      } else if (expression) {
        try {
          const sanitized = expression.replace(/\^/g, "**").replace(/[^0-9+\-*/().e ]/g, "");
          current = Function(`"use strict"; return (${sanitized})`)();
        } catch {
          current = parseFloat(display);
        }
      } else {
        current = parseFloat(display);
      }
      if (isNaN(current)) return;

      let result: number;

      // Domain guards for scientific functions
      if ((func === "log" || func === "ln") && current <= 0) {
        // Fresh calculator state: ignore instead of showing an error immediately
        if (expression === "" && display === "0") {
          setIsShift(false);
          return;
        }
        setDisplay("Math Error");
        setExpression("");
        setHasResult(true);
        setIsShift(false);
        return;
      }

      if (func === "sqrt" && current < 0) {
        setDisplay("Math Error");
        setExpression("");
        setHasResult(true);
        setIsShift(false);
        return;
      }

      if (func === "inv" && current === 0) {
        setDisplay("Math Error");
        setExpression("");
        setHasResult(true);
        setIsShift(false);
        return;
      }

      switch (func) {
        case "sin": result = Math.sin(toRad(current)); break;
        case "cos": result = Math.cos(toRad(current)); break;
        case "tan": result = Math.tan(toRad(current)); break;
        case "asin": result = fromRad(Math.asin(current)); break;
        case "acos": result = fromRad(Math.acos(current)); break;
        case "atan": result = fromRad(Math.atan(current)); break;
        case "log": result = Math.log10(current); break;
        case "ln": result = Math.log(current); break;
        case "sqrt": result = Math.sqrt(current); break;
        case "cbrt": result = Math.cbrt(current); break;
        case "sq": result = current * current; break;
        case "cube": result = current ** 3; break;
        case "inv": result = 1 / current; break;
        case "abs": result = Math.abs(current); break;
        case "fact": result = factorial(current); break;
        case "exp": result = Math.exp(current); break;
        case "10pow": result = Math.pow(10, current); break;
        default: return;
      }

      if (typeof result === "number" && isFinite(result)) {
        const formatted = parseFloat(result.toFixed(10)).toString();
        setDisplay(formatted);
        setExpression(formatted);
        setHasResult(true);
      } else {
        setDisplay("Math Error");
        setExpression("");
        setHasResult(true);
      }
    } catch {
      setDisplay("Error");
      setExpression("");
      setHasResult(true);
    }
    setIsShift(false);
  };

  const factorial = (n: number): number => {
    if (n < 0 || !Number.isInteger(n)) return NaN;
    if (n === 0 || n === 1) return 1;
    if (n > 170) return Infinity;
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  };

  const handleConst = (c: string) => {
    const val = c === "π" ? Math.PI.toString() : c === "e" ? Math.E.toString() : "0";
    if (hasResult || display === "0") {
      setDisplay(val);
      setExpression(val);
    } else {
      setExpression(expression + "*" + val);
      setDisplay(val);
    }
    setHasResult(false);
  };

  const handleEquals = () => {
    try {
      let expr = expression
        .replace(/\^/g, "**")
        .replace(/[^0-9+\-*/().e ]/g, "");
      if (!expr) return;
      const result = Function(`"use strict"; return (${expr})`)();
      if (typeof result === "number" && isFinite(result)) {
        const formatted = parseFloat(result.toFixed(10)).toString();
        setDisplay(formatted);
        setExpression(formatted);
        lastAnswer.current = formatted;
        setHasResult(true);
      } else {
        setDisplay("Math Error");
        setExpression("");
        setHasResult(true);
      }
    } catch {
      setDisplay("Syntax Error");
      setExpression("");
      setHasResult(true);
    }
  };

  const handleClear = () => { setDisplay("0"); setExpression(""); setHasResult(false); };

  const handleBackspace = () => {
    if (hasResult) return;
    if (expression.length > 1) {
      const newExpr = expression.slice(0, -1);
      setExpression(newExpr);
      const parts = newExpr.split(/[+\-*/()^]/);
      setDisplay(parts[parts.length - 1] || "0");
    } else handleClear();
  };

  const handleToggleSign = () => {
    if (display !== "0") {
      const toggled = display.startsWith("-") ? display.slice(1) : "-" + display;
      setDisplay(toggled);
      const match = expression.match(/(.*[+\-*/(%^])?(-?\d+\.?\d*)$/);
      if (match) setExpression((match[1] || "") + toggled);
    }
  };

  const handleAns = () => {
    const val = lastAnswer.current;
    if (hasResult || display === "0") {
      setDisplay(val); setExpression(val);
    } else {
      setExpression(expression + val); setDisplay(val);
    }
    setHasResult(false);
  };

  type BtnType = "num" | "op" | "func" | "sci" | "del" | "ac" | "eq" | "shift";

  interface CalcBtn { label: string; shiftLabel?: string; action: () => void; shiftAction?: () => void; type: BtnType; span?: number; }

  const sciButtons: CalcBtn[] = [
    { label: "SHIFT", action: () => setIsShift(!isShift), type: "shift" },
    { label: "MODE", action: () => setIsDeg(!isDeg), type: "func" },
    { label: isDeg ? "DEG" : "RAD", action: () => setIsDeg(!isDeg), type: "func" },
    { label: "x²", shiftLabel: "x³", action: () => handleScientificFunc("sq"), shiftAction: () => handleScientificFunc("cube"), type: "sci" },
    { label: "xʸ", action: () => handleOperator("^"), type: "sci" },

    { label: "√", shiftLabel: "∛", action: () => handleScientificFunc("sqrt"), shiftAction: () => handleScientificFunc("cbrt"), type: "sci" },
    { label: "log", shiftLabel: "10ˣ", action: () => handleScientificFunc("log"), shiftAction: () => handleScientificFunc("10pow"), type: "sci" },
    { label: "ln", shiftLabel: "eˣ", action: () => handleScientificFunc("ln"), shiftAction: () => handleScientificFunc("exp"), type: "sci" },
    { label: "sin", shiftLabel: "sin⁻¹", action: () => handleScientificFunc("sin"), shiftAction: () => handleScientificFunc("asin"), type: "sci" },
    { label: "cos", shiftLabel: "cos⁻¹", action: () => handleScientificFunc("cos"), shiftAction: () => handleScientificFunc("acos"), type: "sci" },

    { label: "tan", shiftLabel: "tan⁻¹", action: () => handleScientificFunc("tan"), shiftAction: () => handleScientificFunc("atan"), type: "sci" },
    { label: "π", action: () => handleConst("π"), type: "sci" },
    { label: "e", action: () => handleConst("e"), type: "sci" },
    { label: "x⁻¹", action: () => handleScientificFunc("inv"), type: "sci" },
    { label: "n!", action: () => handleScientificFunc("fact"), type: "sci" },
  ];

  const mainButtons: CalcBtn[] = [
    { label: "(", action: () => handleParenthesis("("), type: "func" },
    { label: ")", action: () => handleParenthesis(")"), type: "func" },
    { label: "%", action: () => handleOperator("/100*"), type: "func" },
    { label: "DEL", action: handleBackspace, type: "del" },
    { label: "AC", action: handleClear, type: "ac" },

    { label: "7", action: () => handleNumber("7"), type: "num" },
    { label: "8", action: () => handleNumber("8"), type: "num" },
    { label: "9", action: () => handleNumber("9"), type: "num" },
    { label: "÷", action: () => handleOperator("/"), type: "op" },
    { label: "✕", action: () => handleOperator("*"), type: "op" },

    { label: "4", action: () => handleNumber("4"), type: "num" },
    { label: "5", action: () => handleNumber("5"), type: "num" },
    { label: "6", action: () => handleNumber("6"), type: "num" },
    { label: "−", action: () => handleOperator("-"), type: "op" },
    { label: "+", action: () => handleOperator("+"), type: "op" },

    { label: "1", action: () => handleNumber("1"), type: "num" },
    { label: "2", action: () => handleNumber("2"), type: "num" },
    { label: "3", action: () => handleNumber("3"), type: "num" },
    { label: "+/−", action: handleToggleSign, type: "func" },
    { label: "=", action: handleEquals, type: "eq" },

    { label: "0", action: () => handleNumber("0"), type: "num", span: 2 },
    { label: ".", action: () => handleNumber("."), type: "num" },
    { label: "Ans", action: handleAns, type: "func" },
    { label: "|x|", action: () => handleScientificFunc("abs"), type: "func" },
  ];

  const getButtonStyle = (type: BtnType) => {
    switch (type) {
      case "num":
        return "bg-[#2a2a2e] hover:bg-[#3a3a3e] text-white border-[#1a1a1e] shadow-[inset_0_1px_0_#3a3a3e,0_2px_4px_#0005]";
      case "op":
        return "bg-[#3a3a40] hover:bg-[#4a4a50] text-white border-[#2a2a30] shadow-[inset_0_1px_0_#4a4a4e,0_2px_4px_#0005]";
      case "func":
        return "bg-[#3a3a40] hover:bg-[#4a4a50] text-[#b0b0b8] border-[#2a2a30] shadow-[inset_0_1px_0_#4a4a4e,0_2px_4px_#0005] text-xs";
      case "sci":
        return "bg-[#2e3038] hover:bg-[#3e3e48] text-[#90c0ff] border-[#22242a] shadow-[inset_0_1px_0_#3e4048,0_2px_4px_#0005] text-xs";
      case "shift":
        return "bg-[#c4a035] hover:bg-[#d4b045] text-[#1a1a1e] font-bold border-[#a08025] shadow-[inset_0_1px_0_#e0c060,0_2px_4px_#0005] text-xs";
      case "del":
        return "bg-[#c4a035] hover:bg-[#d4b045] text-[#1a1a1e] font-bold border-[#a08025] shadow-[inset_0_1px_0_#e0c060,0_2px_4px_#0005]";
      case "ac":
        return "bg-[#c04040] hover:bg-[#d05050] text-white font-bold border-[#a03030] shadow-[inset_0_1px_0_#e06060,0_2px_4px_#0005]";
      case "eq":
        return "bg-[#3060a0] hover:bg-[#4070b0] text-white font-bold border-[#204080] shadow-[inset_0_1px_0_#5080c0,0_2px_4px_#0005]";
      default:
        return "bg-[#2a2a2e] text-white";
    }
  };

  const renderBtn = (btn: CalcBtn, i: number) => {
    const showShift = isShift && btn.shiftLabel && btn.shiftAction;
    return (
      <button
        key={`${btn.label}-${i}`}
        onClick={showShift ? btn.shiftAction : btn.action}
        className={`
          ${btn.span === 2 ? "col-span-2" : ""}
          h-[38px] rounded-[5px] text-[12px] font-semibold
          border-b-[2px] active:border-b-0 active:mt-[2px]
          transition-all duration-75 active:scale-[0.97]
          flex items-center justify-center relative
          ${getButtonStyle(btn.type)}
          ${isShift && btn.type === "shift" ? "ring-1 ring-[#e0c060]" : ""}
        `}
      >
        {showShift ? (
          <span className="text-[#ffd060]">{btn.shiftLabel}</span>
        ) : (
          <>
            {btn.shiftLabel && (
              <span className="absolute -top-[10px] text-[7px] text-[#c4a035] font-normal">{btn.shiftLabel}</span>
            )}
            {btn.label}
          </>
        )}
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-[360px] mb-4">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" />
          {lang === "ar" ? "الرجوع" : "Retour"}
        </Link>
      </div>

      {/* Calculator body */}
      <div className="w-full max-w-[360px] rounded-[20px] p-[2px] bg-gradient-to-b from-[#4a4a50] to-[#1a1a1e]">
        <div
          className="rounded-[18px] p-4 space-y-3"
          style={{
            background: "linear-gradient(180deg, #2c2c30 0%, #1e1e22 30%, #18181c 100%)",
            boxShadow: "inset 0 1px 2px rgba(255,255,255,0.05), 0 8px 32px rgba(0,0,0,0.6)",
          }}
        >
          {/* Brand */}
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-bold tracking-[0.2em] text-[#888] uppercase">ILYASS</span>
            <span className="text-[11px] text-[#666] tracking-wider">fx-991ES PLUS</span>
          </div>

          {/* LCD Screen */}
          <div
            className="rounded-lg p-3 text-right space-y-0.5"
            style={{
              background: "linear-gradient(180deg, #c8d8b0 0%, #b8c8a0 50%, #a8b890 100%)",
              boxShadow: "inset 0 2px 8px rgba(0,0,0,0.25), inset 0 -1px 0 rgba(255,255,255,0.3)",
              border: "2px solid #555",
            }}
          >
            <div className="flex justify-between items-center">
              <span className="text-[11px] font-mono" style={{ color: "#5a6a4a" }}>
                {isDeg ? "D" : "R"} {isShift ? "S" : ""}
              </span>
              <span className="text-[11px] font-mono" style={{ color: "#5a6a4a" }}>Math</span>
            </div>
            <p className="text-xs font-mono min-h-[0.9rem] truncate" style={{ color: "#3a4a2a" }}>
              {expression ? expression.replace(/\*/g, "×").replace(/\//g, "÷") : " "}
            </p>
            <p className="text-[26px] font-bold font-mono truncate leading-tight" style={{ color: "#1a2a0a" }}>
              {display}
            </p>
          </div>

          {/* Scientific buttons */}
          <div className="grid grid-cols-5 gap-[4px]">
            {sciButtons.map((btn, i) => renderBtn(btn, i))}
          </div>

          {/* Separator */}
          <div className="h-px bg-gradient-to-r from-transparent via-[#444] to-transparent" />

          {/* Main buttons */}
          <div className="grid grid-cols-5 gap-[4px]">
            {mainButtons.map((btn, i) => renderBtn(btn, i + 100))}
          </div>

          {/* Bottom */}
          <div className="text-center pt-0.5">
            <span className="text-[7px] text-[#555] tracking-[0.15em] uppercase">NATURAL-V.P.A.M. • SCIENTIFIC CALCULATOR</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CalculatorPage;
