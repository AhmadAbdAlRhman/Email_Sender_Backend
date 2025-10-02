const express = require("express")
const cors = require("cors")
const multer = require("multer")
const nodemailer = require("nodemailer")
const XLSX = require("xlsx")
const { parse } = require("csv-parse")
const path = require("path")
const fs = require("fs")
const fileUpload = require("express-fileupload")

const app = express()
const PORT = 3001

const EMAIL_USER = "mohammedyasser2019b@gmail.com"
const EMAIL_PASSWORD = "scbg axac fbky ylxg"

// CORS Configuration
app.use(
  cors({
    origin: ["http://localhost:5173", "http://localhost:3000", "https://email-sender-mocha-mu.vercel.app"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
)

app.options("*", cors())

// Middleware
app.use(express.json({ limit: "50mb" }))
app.use(express.urlencoded({ extended: true, limit: "50mb" }))
app.use(
  fileUpload({
    limits: { fileSize: 50 * 1024 * 1024 },
    useTempFiles: true,
    tempFileDir: "/tmp/",
  }),
)

// Create uploads and temp directories
const uploadsDir = path.join(__dirname, "Uploads")
const tempDir = path.join(__dirname, "temp")
;[uploadsDir, tempDir].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
})

// Persistent data storage
const DATA_FILE = path.join(__dirname, "data.json")

function loadData() {
  if (fs.existsSync(DATA_FILE)) {
    const raw = fs.readFileSync(DATA_FILE, "utf8")
    try {
      return JSON.parse(raw)
    } catch (error) {
      console.error("Error parsing data file:", error)
      return { emails: [], groups: [] }
    }
  }
  return { emails: [], groups: [] }
}

function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8")
  } catch (error) {
    console.error("Error saving data:", error)
  }
}

const createTransporter = () => {
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: EMAIL_USER,
      pass: EMAIL_PASSWORD,
    },
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    rateDelta: 1000,
    rateLimit: 5,
  })
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "Uploads/")
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${file.originalname}`
    cb(null, uniqueName)
  },
})

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "text/csv",
    ]
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error("يجب أن يكون الملف من نوع Excel (.xlsx, .xls) أو CSV (.csv)"))
    }
  },
})

app.get("/api/test-email", async (req, res) => {
  try {
    const transporter = createTransporter()
    await transporter.verify()
    res.json({ success: true, message: "إعدادات الإيميل جاهزة" })
  } catch (error) {
    console.error("Email configuration error:", error)
    res.json({ success: false, error: "فشل في إعداد الإيميل: " + error.message })
  }
})

// Parse file (Excel or CSV)
const parseFile = async (filePath, fileExtension) => {
  try {
    const emails = []
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

    if (fileExtension === ".csv") {
      const parser = fs.createReadStream(filePath).pipe(parse({ delimiter: ",", columns: true, trim: true }))

      for await (const record of parser) {
        Object.values(record).forEach((value) => {
          if (typeof value === "string" && emailRegex.test(value.trim()) && !emails.includes(value.trim())) {
            emails.push(value.trim())
          }
        })
      }
    } else {
      const workbook = XLSX.readFile(filePath)
      workbook.SheetNames.forEach((sheetName) => {
        const worksheet = workbook.Sheets[sheetName]
        const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 })

        if (data.length === 0) return

        const headers = data[0] || []
        const emailColumnIndices = []

        headers.forEach((header, index) => {
          if (header && typeof header === "string") {
            const headerLower = header.toLowerCase().trim()
            const emailKeywords = [
              "email",
              "e-mail",
              "mail",
              "emails",
              "Emails",
              "البريد",
              "الايميل",
              "ايميل",
              "الإيميل",
              "البريد الالكتروني",
              "البريد الإلكتروني",
            ]

            if (emailKeywords.some((keyword) => headerLower.includes(keyword.toLowerCase()))) {
              emailColumnIndices.push(index)
            }
          }
        })

        if (emailColumnIndices.length === 0) {
          for (let colIndex = 0; colIndex < headers.length; colIndex++) {
            for (let rowIndex = 1; rowIndex < Math.min(data.length, 10); rowIndex++) {
              const cellValue = data[rowIndex]?.[colIndex]
              if (cellValue && typeof cellValue === "string") {
                if (emailRegex.test(cellValue.trim())) {
                  if (!emailColumnIndices.includes(colIndex)) {
                    emailColumnIndices.push(colIndex)
                  }
                  break
                }
              }
            }
          }
        }

        data.slice(1).forEach((row) => {
          emailColumnIndices.forEach((colIndex) => {
            const cellValue = row[colIndex]
            if (cellValue && typeof cellValue === "string") {
              const email = cellValue.trim()
              if (emailRegex.test(email) && !emails.includes(email)) {
                emails.push(email)
              }
            }
          })
        })
      })
    }

    return { success: true, emails, count: emails.length }
  } catch (error) {
    console.error("File parsing error:", error)
    return { success: false, error: "فشل في قراءة الملف: " + error.message }
  }
}

app.post("/api/upload-file", (req, res) => {
  try {
    if (!req.files || !req.files.file) {
      return res.json({ success: false, error: "لم يتم العثور على ملف" })
    }

    const uploadedFile = req.files.file
    const allowedExtensions = [".xlsx", ".xls", ".csv"]
    const fileExtension = path.extname(uploadedFile.name).toLowerCase()

    if (!allowedExtensions.includes(fileExtension)) {
      return res.json({ success: false, error: "يجب أن يكون الملف من نوع Excel (.xlsx, .xls) أو CSV (.csv)" })
    }

    const fileName = `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}${fileExtension}`
    const filePath = path.join(tempDir, fileName)

    uploadedFile.mv(filePath, async (err) => {
      if (err) {
        console.error("File upload error:", err)
        return res.json({ success: false, error: "فشل في رفع الملف: " + err.message })
      }

      const result = await parseFile(filePath, fileExtension)

      try {
        fs.unlinkSync(filePath)
      } catch (deleteError) {
        console.warn("Could not delete temporary file:", deleteError)
      }

      if (result.success) {
        if (result.emails.length === 0) {
          return res.json({ success: false, error: "لم يتم العثور على إيميلات صالحة في الملف" })
        }
        res.json(result)
      } else {
        res.json(result)
      }
    })
  } catch (error) {
    console.error("Upload error:", error)
    res.json({ success: false, error: "خطأ في معالجة الملف: " + error.message })
  }
})

const sendBulkEmails = async (emailList, subject, content, attachments) => {
  const results = {
    successful: 0,
    failed: 0,
    errors: [],
  }

  const batchSize = 10
  const delay = 1000

  const transporter = createTransporter()

  for (let i = 0; i < emailList.length; i += batchSize) {
    const batch = emailList.slice(i, i + batchSize)
    const batchPromises = batch.map(async (email) => {
      try {
        const mailOptions = {
          from: {
            name: "نظام إرسال الرسائل",
            address: EMAIL_USER,
          },
          to: email,
          subject: subject || "رسالة بدون عنوان",
          text: content || "رسالة بدون محتوى",
          html: `
            <!DOCTYPE html>
            <html lang="ar" dir="rtl">
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <style>
                body {
                  font-family: Arial, sans-serif;
                  color: #333;
                  margin: 0;
                  padding: 0;
                  width: 100%;
                  height: 100%;
                  background-color: #f9f9f9;
                }
                .container {
                  max-width: 100%;
                  margin: 0;
                  padding: 20px;
                  background-color: #ffffff;
                  box-shadow: 0 0 10px rgba(0,0,0,0.1);
                }
                h2 {
                  color: #2d3748;
                  text-align: center;
                  padding: 10px 0;
                }
                p {
                  font-size: 16px;
                  line-height: 1.6;
                  padding: 10px;
                }
                .footer {
                  text-align: center;
                  font-size: 12px;
                  color: #718096;
                  padding: 10px;
                  border-top: 1px solid #e2e8f0;
                }
              </style>
            </head>
            <body>
              <div class="container">
                <p>${content || "رسالة بدون محتوى"}</p>
                <div class="footer">
                  تم إرسال هذه الرسالة من نظام إرسال الرسائل الآلي
                </div>
              </div>
            </body>
            </html>
          `,
          attachments: attachments,
        }

        const info = await transporter.sendMail(mailOptions)
        console.log(`Email sent to ${email}:`, info.messageId)
        results.successful++

        return { email, success: true, messageId: info.messageId }
      } catch (error) {
        console.error(`Failed to send email to ${email}:`, error.message)
        results.failed++
        results.errors.push({ email, error: error.message })

        return { email, success: false, error: error.message }
      }
    })

    await Promise.all(batchPromises)

    if (i + batchSize < emailList.length) {
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  return results
}

app.post("/api/send-emails", async (req, res) => {
  console.log("[v0] Received send-emails request")
  try {
    const { subject, content, emails } = req.body
    console.log("[v0] Request body:", { subject, content, emailsLength: emails?.length })

    let emailList

    try {
      emailList = JSON.parse(emails)
      console.log("[v0] Parsed email list:", emailList.length, "emails")
    } catch (parseError) {
      console.error("[v0] Parse error:", parseError)
      return res.json({ success: false, error: "خطأ في تحليل قائمة الإيميلات" })
    }

    if (!emailList || !Array.isArray(emailList) || emailList.length === 0) {
      console.error("[v0] Invalid email list")
      return res.json({ success: false, error: "قائمة الإيميلات فارغة أو غير صالحة" })
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    const validEmails = emailList.filter((email) => typeof email === "string" && emailRegex.test(email.trim()))

    if (validEmails.length === 0) {
      console.error("[v0] No valid emails found")
      return res.json({ success: false, error: "لا توجد إيميلات صالحة في القائمة" })
    }

    console.log(`[v0] Preparing to send ${validEmails.length} emails...`)

    try {
      const testTransporter = createTransporter()
      await testTransporter.verify()
      console.log("[v0] Email configuration verified successfully")
    } catch (verifyError) {
      console.error("[v0] Email verification failed:", verifyError)
      return res.json({
        success: false,
        error: "فشل في التحقق من إعدادات الإيميل. تأكد من صحة كلمة المرور: " + verifyError.message,
      })
    }

    const attachments = []
    if (req.files) {
      console.log("[v0] Processing attachments...")
      const attachmentPromises = Object.keys(req.files)
        .filter((key) => key.startsWith("attachment"))
        .map(async (key) => {
          const file = req.files[key]
          const fileName = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}_${file.name}`
          const filePath = path.join(uploadsDir, fileName)

          try {
            await new Promise((resolve, reject) => {
              file.mv(filePath, (err) => {
                if (err) reject(err)
                else resolve()
              })
            })

            return {
              filename: file.name,
              path: filePath,
              contentType: file.mimetype,
            }
          } catch (error) {
            console.error("[v0] Attachment processing error:", error)
            return null
          }
        })

      const processedAttachments = await Promise.all(attachmentPromises)
      attachments.push(...processedAttachments.filter(Boolean))
      console.log(`[v0] Processed ${attachments.length} attachments`)
    }

    console.log(`[v0] Starting bulk email send...`)
    const results = await sendBulkEmails(validEmails, subject, content, attachments)

    attachments.forEach((attachment) => {
      try {
        if (fs.existsSync(attachment.path)) {
          fs.unlinkSync(attachment.path)
        }
      } catch (cleanupError) {
        console.warn("[v0] Could not delete attachment file:", cleanupError)
      }
    })

    console.log("[v0] Email sending completed:", results)

    if (results.successful > 0) {
      res.json({
        success: true,
        message: `تم إرسال ${results.successful} رسالة بنجاح` + (results.failed > 0 ? ` وفشل ${results.failed}` : ""),
        sent: results.successful,
        failed: results.failed,
        total: validEmails.length,
      })
    } else {
      res.json({
        success: false,
        error: "فشل في إرسال جميع الرسائل",
        details: results.errors,
      })
    }
  } catch (error) {
    console.error("[v0] Send emails error:", error)
    res.json({ success: false, error: "خطأ في إرسال الرسائل: " + error.message })
  }
})

app.post("/api/send-single-email", async (req, res) => {
  try {
    const { to, subject, content } = req.body

    if (!to || !subject) {
      return res.json({ success: false, error: "البيانات المطلوبة مفقودة" })
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(to)) {
      return res.json({ success: false, error: "عنوان الإيميل غير صالح" })
    }

    const transporter = createTransporter()
    const mailOptions = {
      from: {
        name: "نظام إرسال الرسائل",
        address: EMAIL_USER,
      },
      to: to,
      subject: subject,
      text: content || "رسالة تجريبية",
      html: `
        <!DOCTYPE html>
        <html lang="ar" dir="rtl">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body {
              font-family: Arial, sans-serif;
              color: #333;
              margin: 0;
              padding: 0;
              width: 100%;
              height: 100%;
              background-color: #f9f9f9;
            }
            .container {
              max-width: 100%;
              margin: 0;
              padding: 20px;
              background-color: #ffffff;
              box-shadow: 0 0 10px rgba(0,0,0,0.1);
            }
            h2 {
              color: #2d3748;
              text-align: center;
              padding: 10px 0;
            }
            p {
              font-size: 16px;
              line-height: 1.6;
              padding: 10px;
            }
            .footer {
              text-align: center;
              font-size: 12px;
              color: #718096;
              padding: 10px;
              border-top: 1px solid #e2e8f0;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h2>${subject}</h2>
            <p>${content ? content.replace(/\n/g, "<br>") : "رسالة تجريبية"}</p>
            <div class="footer">
              تم إرسال هذه الرسالة من نظام إرسال الرسائل الآلي
            </div>
          </div>
        </body>
        </html>
      `,
    }

    const info = await transporter.sendMail(mailOptions)
    console.log("Single email sent:", info.messageId)
    res.json({ success: true, message: "تم إرسال الرسالة بنجاح", messageId: info.messageId })
  } catch (error) {
    console.error("Send single email error:", error)
    res.json({ success: false, error: "فشل في إرسال الرسالة: " + error.message })
  }
})

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "الخادم يعمل بشكل طبيعي",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  })
})

app.get("/api/status", (req, res) => {
  res.json({
    success: true,
    server: "Professional Email Sender API",
    version: "4.0.0",
    status: "running",
    uptime: Math.floor(process.uptime()),
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + " MB",
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + " MB",
    },
    timestamp: new Date().toISOString(),
    features: [
      "Bulk Email Sending",
      "Excel and CSV Import/Export",
      "Multiple Attachments",
      "Email Groups Management",
      "Connection Pooling",
      "Batch Processing",
      "Professional UI/UX",
      "Persistent Data Storage",
      "No Authentication Required",
    ],
  })
})

app.get("/api/get-data", (req, res) => {
  const data = loadData()
  res.json({ success: true, emails: data.emails || [], groups: data.groups || [] })
})

app.post("/api/save-data", (req, res) => {
  const { emails, groups } = req.body
  const data = { emails: emails || [], groups: groups || [] }
  saveData(data)
  res.json({ success: true })
})

app.post("/api/clear-data", (req, res) => {
  saveData({ emails: [], groups: [] })
  res.json({ success: true })
})

// Clean up old files periodically
const cleanupOldFiles = () => {
  const directories = [uploadsDir, tempDir]
  const maxAge = 24 * 60 * 60 * 1000

  directories.forEach((dir) => {
    try {
      if (!fs.existsSync(dir)) return

      const files = fs.readdirSync(dir)
      files.forEach((file) => {
        const filePath = path.join(dir, file)
        const stats = fs.statSync(filePath)

        if (Date.now() - stats.mtime.getTime() > maxAge) {
          fs.unlinkSync(filePath)
          console.log(`Cleaned up old file: ${file}`)
        }
      })
    } catch (error) {
      console.warn(`Cleanup error in ${dir}:`, error)
    }
  })
}

setInterval(cleanupOldFiles, 60 * 60 * 1000)

// Error handling middleware
app.use((error, req, res, next) => {
  console.error("Server error:", error)
  res.status(500).json({
    success: false,
    error: "خطأ في الخادم",
    message: process.env.NODE_ENV === "development" ? error.message : "خطأ داخلي",
  })
})

// Handle 404 errors
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "المسار غير موجود",
    path: req.originalUrl,
  })
})

// Start server
const server = app.listen(PORT, () => {
  console.log(`🚀 Professional Email Sender Server running on http://localhost:${PORT}`)
  console.log(`📧 Ready to send emails with enhanced features!`)
  console.log(`📁 Upload directories:`)
  console.log(`   - Uploads: ${uploadsDir}`)
  console.log(`   - Temp: ${tempDir}`)
  console.log(`📊 Features:`)
  console.log(`   - ✅ Bulk email sending with batching`)
  console.log(`   - ✅ Advanced Excel and CSV parsing`)
  console.log(`   - ✅ Multiple attachments support`)
  console.log(`   - ✅ Connection pooling`)
  console.log(`   - ✅ Automatic file cleanup`)
  console.log(`   - ✅ Professional UI/UX`)
  console.log(`   - ✅ Persistent data storage`)
  console.log(`   - ✅ No authentication required`)
  console.log(`📧 Using email: ${EMAIL_USER}`)
})

// Graceful shutdown
const gracefulShutdown = (signal) => {
  console.log(`\n🛑 ${signal} received. Shutting down Professional Email Sender Server...`)

  server.close(() => {
    console.log("✅ HTTP server closed.")
    cleanupOldFiles()
    console.log("✅ File cleanup completed.")
    console.log("👋 Server shutdown complete.")
    process.exit(0)
  })

  setTimeout(() => {
    console.log("❌ Forcing server shutdown...")
    process.exit(1)
  }, 10000)
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"))
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"))
process.on("uncaughtException", (error) => {
  console.error("💥 Uncaught Exception:", error)
  gracefulShutdown("UNCAUGHT_EXCEPTION")
})
process.on("unhandledRejection", (reason, promise) => {
  console.error("💥 Unhandled Promise Rejection:", reason)
  gracefulShutdown("UNHANDLED_REJECTION")
})

module.exports = app
