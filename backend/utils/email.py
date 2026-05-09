from fastapi_mail import FastMail, MessageSchema, ConnectionConfig
from jinja2 import Environment, FileSystemLoader
import os
import logging

logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

conf = ConnectionConfig(
    MAIL_USERNAME=os.getenv("MAIL_USERNAME"),
    MAIL_PASSWORD=os.getenv("MAIL_PASSWORD"),
    MAIL_FROM=os.getenv("MAIL_FROM"),
    MAIL_PORT=int(os.getenv("MAIL_PORT")),
    MAIL_SERVER=os.getenv("MAIL_SERVER"),
    MAIL_STARTTLS=True,
    MAIL_SSL_TLS=False,
    USE_CREDENTIALS=True,
    TEMPLATE_FOLDER="templates"
)

async def send_alert_email(user_email: str, alert_info: dict, thresholds: dict):
    logger.info("E-mail gönderme işlemi başlatıldı...")

    try:
        env = Environment(loader=FileSystemLoader("templates"))
        template = env.get_template("email_alert.html")

        html = template.render(
            timestamp=alert_info["timestamp"],
            co2=alert_info["co2"],
            pm25=alert_info["pm25"],
            pm10=alert_info["pm10"],
            voc=alert_info["voc"],
            thresholds=thresholds
        )

        message = MessageSchema(
            subject="⚠️ Hava Kalitesi Alarmı",
            recipients=[user_email],
            body=html,
            subtype="html"
        )

        fm = FastMail(conf)
        await fm.send_message(message)
        logger.info(f"E-mail başarıyla gönderildi: {user_email}")

    except Exception as e:
        logger.error(f"E-mail gönderimi sırasında bir hata oluştu: {e}")
        logger.exception("Hata Detayı: ")

